// HMRC enquiry intake — CANONICAL enquiry-capability route (§5.4 reconcile).
// Customer uploads the HMRC notice PDF (officer letter, compliance check,
// assessment, penalty notice). We:
//   1. Persist the notice into the canonical vat_hmrc_enquiries table (sql_001
//      + sql_009 intake columns)
//   2. Compute the response deadline (HMRC standard: 30 days unless specified)
//   3. Assign a CTA / CIOT / ATT partner firm (regulated advice on individual cases)
//   4. Kick off draft-response generation via India QA + Claude
//   5. Fire Telegram + n8n operational alerts (folded in from the deleted
//      duplicate /api/vat-enquiry/intake route — one canonical route per capability)
//
// Every HMRC enquiry is high stakes. India QA + CTA partner involvement is
// mandatory. civil_evasion intakes escalate: priority 'critical', 4h QA SLA.
//
// Triggered from the dashboard "HMRC enquiry studio" (per-enquiry one-off
// product — price set at launch).

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { createRouteClient, supabaseAdmin } from '@/lib/supabase'
import { rateLimit, clientIp } from '@/lib/rate-limit'

const Body = z.object({
  customer_id: z.string().uuid(),
  notice_pdf_url: z.string().url(),
  notice_reference: z.string().optional(),
  enquiry_type: z.enum(['desk_based', 'on_site_visit', 'aspect', 'full', 'assessment', 'civil_evasion']),
  periods_under_enquiry: z.array(z.string()).min(1),
  officer_name: z.string().optional(),
  officer_email: z.string().email().optional(),
  response_deadline: z.string().optional(),         // ISO date — if omitted we default to +30 days
  customer_notes: z.string().optional(),
})

// vat_hmrc_enquiries.notice_type is the DELIVERY-CHANNEL axis (sql_001 check:
// written/officer_visit/pre_arranged/phone/schedule_36); enquiry_type is the
// SCOPE axis and persists via the sql_009 additive column. Map channel:
function noticeTypeFor(enquiryType: string): 'written' | 'officer_visit' {
  return enquiryType === 'on_site_visit' ? 'officer_visit' : 'written'
}

async function fireTelegramAlert(message: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_CHAT_ID
  if (!token || !chatId) return
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'Markdown' }),
    })
  } catch {/* non-fatal */}
}

async function fireN8nWebhook(payload: Record<string, unknown>): Promise<void> {
  const url = process.env.N8N_WEBHOOK_VAT_ENQUIRY
  if (!url) return
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  } catch {/* non-fatal */}
}

export async function POST(request: NextRequest) {
  // Rate limit: 10 enquiry intakes/min per IP (authed write + India-QA/CTA fan-out).
  const rl = rateLimit({ key: `enquiry-intake:${clientIp(request.headers)}`, limit: 10, windowSec: 60 })
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many requests', retry_after_sec: rl.resetInSec },
      { status: 429, headers: { 'Retry-After': String(rl.resetInSec), 'X-RateLimit-Remaining': String(rl.remaining) } },
    )
  }

  const supabase = await createRouteClient()
  // getUser() validates the JWT server-side; getSession() only decodes the cookie.
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  let body
  try { body = Body.parse(await request.json()) }
  catch (e: any) { return NextResponse.json({ error: 'Invalid body', details: e.errors ?? String(e) }, { status: 400 }) }

  // Ownership check
  const { data: customer } = await supabase
    .from('vat_customers').select('id, profile_id, tier, legal_name, vrn').eq('id', body.customer_id).single()
  if (!customer || customer.profile_id !== user.id) {
    return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
  }

  // Default deadline: 30 days from receipt (HMRC compliance check standard).
  // civil_evasion also gets 30 days but escalates priority + QA SLA below.
  const deadline = body.response_deadline || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const priority = body.enquiry_type === 'civil_evasion' ? 'critical' : 'high'

  // Pick an active CTA partner by simple round-robin (load balancer in production).
  // §5.4 reconcile: canonical table is vat_cta_partners (sql_001; RLS default-deny
  // per sql_006), read via the SERVICE ROLE behind the getUser gate above. Only
  // partner_id + firm_name are selected — partner PII (email/phone) and commercial
  // terms (fee splits) never reach the customer response.
  const { data: partner } = await supabaseAdmin
    .from('vat_cta_partners').select('partner_id, firm_name')
    .eq('active', true)
    .limit(1).single()

  // Persist enquiry record into the canonical vat_hmrc_enquiries table
  // (column-accurate: notice_reference->hmrc_reference, notice_received_at->
  // opened_on, response_deadline->deadline, stage->status 'triaged';
  // notice_pdf_url / enquiry_type / periods_under_enquiry /
  // cta_partner_assigned_at are sql_009 additive columns).
  const { data: enquiry, error: insertErr } = await supabase
    .from('vat_hmrc_enquiries').insert({
      customer_id: body.customer_id,
      notice_type: noticeTypeFor(body.enquiry_type),
      opened_on: new Date().toISOString().slice(0, 10),
      hmrc_reference: body.notice_reference || null,
      notice_pdf_url: body.notice_pdf_url,
      enquiry_type: body.enquiry_type,
      periods_under_enquiry: body.periods_under_enquiry,
      officer_name: body.officer_name || null,
      officer_email: body.officer_email || null,
      deadline,
      status: 'triaged',
      cta_partner_id: partner?.partner_id || null,
      cta_partner_assigned_at: partner ? new Date().toISOString() : null,
    }).select().single()

  if (insertErr) {
    console.error('vat_hmrc_enquiries insert failed:', insertErr.message)
    return NextResponse.json({ error: 'Could not log enquiry' }, { status: 500 })
  }

  // Raise dashboard alert — canonical vat_alerts columns (sql_001: alert_type
  // from the check list, trigger_date, jsonb payload; no category/message columns).
  await supabase.from('vat_alerts').insert({
    customer_id: body.customer_id,
    alert_type: 'hmrc_enquiry_deadline_imminent',
    trigger_date: deadline,
    severity: 'critical',
    payload: { enquiry_id: enquiry.id, enquiry_type: body.enquiry_type, message: `HMRC ${body.enquiry_type.replace(/_/g, ' ')} enquiry received — response due ${deadline}` },
  })

  // Kick off CTA partner referral webhook
  if (partner && process.env.CTA_PARTNER_WEBHOOK_URL) {
    try {
      await fetch(process.env.CTA_PARTNER_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.CTA_PARTNER_API_KEY || '' },
        body: JSON.stringify({
          vertical: 'vat.law',
          enquiry_id: enquiry.id,
          cta_partner_id: partner.partner_id,
          customer_legal_name: customer.legal_name,
          customer_vrn: customer.vrn,
          enquiry_type: body.enquiry_type,
          periods: body.periods_under_enquiry,
          response_deadline: deadline,
          notice_pdf_url: body.notice_pdf_url,
        }),
      })
    } catch {/* non-fatal — alert already raised */}
  }

  // Fan to India QA — kick off draft-response generation
  // (civil_evasion escalates to a 4h SLA; everything else 48h)
  try {
    await fetch(process.env.INDIA_QA_QUEUE_WEBHOOK || '', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.INDIA_QA_QUEUE_API_KEY || '' },
      body: JSON.stringify({
        vertical: 'vat.law',
        task: 'draft_hmrc_enquiry_response',
        customer_id: body.customer_id,
        enquiry_id: enquiry.id,
        enquiry_type: body.enquiry_type,
        priority,
        periods: body.periods_under_enquiry,
        deadline,
        cta_partner_id: partner?.partner_id || null,
        sla_hours: body.enquiry_type === 'civil_evasion' ? 4 : 48,
      }),
    })
  } catch {/* non-fatal */}

  // Telegram operational alert (folded in from the deleted duplicate route —
  // all enquiries are high-stakes; env-gated, degrade-safe)
  await fireTelegramAlert(
    `*VAT.LAW — HMRC ENQUIRY LOGGED*\n` +
    `Type: ${body.enquiry_type.replace(/_/g, ' ').toUpperCase()}\n` +
    `Customer: ${customer.legal_name}\n` +
    `Priority: ${priority.toUpperCase()}\n` +
    `Deadline: ${deadline}\n` +
    (body.notice_reference ? `Ref: ${body.notice_reference}\n` : '') +
    `\nDo NOT respond without India QA + CTA adviser sign-off.`
  )

  // n8n webhook (folded in from the deleted duplicate route; env-gated)
  await fireN8nWebhook({
    vertical: 'vat.law',
    event: 'enquiry_intake',
    enquiry_id: enquiry.id,
    customer_id: body.customer_id,
    enquiry_type: body.enquiry_type,
    priority,
    response_deadline: deadline,
    hmrc_reference: body.notice_reference ?? null,
    india_qa_required: true,
  })

  return NextResponse.json({
    enquiry,
    cta_partner: partner ? { partner_id: partner.partner_id, firm_name: partner.firm_name } : null,
    response_deadline: deadline,
    priority,
    next_steps: [
      'India QA pulls customer return history for the affected periods',
      body.enquiry_type === 'civil_evasion'
        ? 'CRITICAL: civil evasion enquiry — draft response escalated to a 4-hour QA SLA'
        : 'Draft response generated within 48 hours',
      partner ? `Routed to ${partner.firm_name} for regulated advice + signature` : 'CTA partner assignment pending',
      'Customer reviews and approves before submission to HMRC',
    ],
  })
}
