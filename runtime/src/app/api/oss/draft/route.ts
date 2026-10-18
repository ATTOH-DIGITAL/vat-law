// Draft an OSS (One Stop Shop) / IOSS return — country-by-country breakdown
// for distance sales of goods (OSS Union scheme) or low-value imported goods (IOSS).
//
// UK businesses post-Brexit typically register for OSS Union via Ireland (IE) as
// the reporting Member State. vat.law collates Member-State-rate-coded sales,
// groups by destination country + applicable rate, and computes the per-country
// VAT due. The draft is staged for India QA review (always — cross-border tier).

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { createRouteClient } from '@/lib/supabase'
import { rateLimit, clientIp } from '@/lib/rate-limit'

const Body = z.object({
  customer_id: z.string().uuid(),
  scheme: z.enum(['oss_union', 'oss_non_union', 'ioss']),
  quarter: z.string().regex(/^\d{4}-Q[1-4]$/),
  reporting_member_state: z.string().length(2).default('IE'),
})

// Minimal EU standard-rate lookup (May 2026). Real lookup table lives in Supabase
// (vat_rate_eu reference data updated monthly via cron); this is the fallback.
const EU_STANDARD_RATES: Record<string, number> = {
  AT: 20, BE: 21, BG: 20, CY: 19, CZ: 21, DE: 19, DK: 25, EE: 22, ES: 21,
  FI: 25.5, FR: 20, GR: 24, HR: 25, HU: 27, IE: 23, IT: 22, LT: 21, LU: 17,
  LV: 21, MT: 18, NL: 21, PL: 23, PT: 23, RO: 19, SE: 25, SI: 22, SK: 23,
}

function quarterToDates(q: string): { start: string; end: string } {
  const [y, qq] = q.split('-Q')
  const year = Number(y), quarter = Number(qq)
  const startMonth = (quarter - 1) * 3        // 0,3,6,9
  const start = new Date(Date.UTC(year, startMonth, 1))
  const end = new Date(Date.UTC(year, startMonth + 3, 0))
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  return { start: iso(start), end: iso(end) }
}

export async function POST(request: NextRequest) {
  // Rate limit: 10 OSS drafts/min per IP (authed write + India-QA webhook fan-out).
  const rl = rateLimit({ key: `oss-draft:${clientIp(request.headers)}`, limit: 10, windowSec: 60 })
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

  // Ownership check + cross-border-tier check
  const { data: customer } = await supabase
    .from('vat_customers').select('id, profile_id, tier, legal_name')
    .eq('id', body.customer_id).single()
  if (!customer || customer.profile_id !== user.id) {
    return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
  }
  if (customer.tier !== 'cross_border') {
    return NextResponse.json({ error: 'OSS / IOSS drafting requires the Cross-Border tier (£149/mo)' }, { status: 402 })
  }

  const { start, end } = quarterToDates(body.quarter)

  // Pull qualifying sales invoices in the period (B2C cross-border within EU for OSS;
  // B2C imports up to €150 consignment for IOSS).
  const { data: invoices, error: invErr } = await supabase
    .from('vat_invoices').select('*')
    .eq('customer_id', body.customer_id)
    .eq('direction', 'sales')
    .gte('invoice_date', start)
    .lte('invoice_date', end)
  if (invErr) {
    console.error('vat_invoices read failed:', invErr.message)
    return NextResponse.json({ error: 'Could not load invoices' }, { status: 500 })
  }

  // Group by destination country + rate
  type Row = { country: string; vat_rate: number; taxable_amount: number; vat_due: number }
  const map = new Map<string, Row>()
  for (const inv of invoices || []) {
    // Filter to OSS-eligible: B2C (no counterparty VAT number) and EU destination
    if (inv.counterparty_vat_number) continue
    const country = (inv.counterparty_country || '').toUpperCase()
    if (!country || country === 'GB') continue
    // For OSS Union we expect EU member states; for IOSS, low-value imports.
    if (body.scheme !== 'ioss' && !(country in EU_STANDARD_RATES)) continue

    const rate = inv.vat_rate || EU_STANDARD_RATES[country] || 0
    const key = `${country}:${rate}`
    const existing = map.get(key) || { country, vat_rate: rate, taxable_amount: 0, vat_due: 0 }
    existing.taxable_amount += Number(inv.net_amount || 0)
    existing.vat_due += Number(inv.vat_amount || (inv.net_amount * rate / 100))
    map.set(key, existing)
  }

  const breakdown = Array.from(map.values())
    .map(r => ({ ...r, taxable_amount: +r.taxable_amount.toFixed(2), vat_due: +r.vat_due.toFixed(2) }))
    .sort((a, b) => b.vat_due - a.vat_due)
  const total_vat_due = +breakdown.reduce((a, b) => a + b.vat_due, 0).toFixed(2)
  const total_net = +breakdown.reduce((a, b) => a + b.taxable_amount, 0).toFixed(2)

  // Canonical vat_oss_returns.country_breakdown shape (sql_001 §6):
  //   { "FR": { net, vat, rate }, ... } — object keyed by destination country.
  // The `breakdown` array above stays for the API response; this is the persisted
  // form. (Same country can appear across multiple rates in `breakdown`; fold them.)
  const country_breakdown: Record<string, { net: number; vat: number; rate: number }> = {}
  for (const r of breakdown) {
    const existing = country_breakdown[r.country]
    if (existing) {
      existing.net = +(existing.net + r.taxable_amount).toFixed(2)
      existing.vat = +(existing.vat + r.vat_due).toFixed(2)
    } else {
      country_breakdown[r.country] = { net: r.taxable_amount, vat: r.vat_due, rate: r.vat_rate }
    }
  }

  // Persist as a draft OSS return into the canonical vat_oss_returns table —
  // always pending India QA review on the Cross-Border tier. Column-accurate
  // reconcile (pass-8, §5.4): quarter->period, member_state_breakdown->
  // country_breakdown (object shape), total_vat_due->total_vat, +total_net,
  // status 'awaiting_qa'->'india_qa_review' (sql_001 status check admits it).
  // reporting_member_state is the OSS Member State of Identification (sql_008).
  const { data: ossReturn, error: insertErr } = await supabase
    .from('vat_oss_returns').insert({
      customer_id: body.customer_id,
      scheme: body.scheme,
      period: body.quarter,
      period_start: start,
      period_end: end,
      country_breakdown,
      total_net,
      total_vat: total_vat_due,
      reporting_member_state: body.reporting_member_state,
      status: 'india_qa_review',
    }).select().single()

  if (insertErr) {
    console.error('vat_oss_returns insert failed:', insertErr.message)
    return NextResponse.json({ error: 'Could not save OSS draft' }, { status: 500 })
  }

  // Push to India QA
  try {
    await fetch(process.env.INDIA_QA_QUEUE_WEBHOOK || '', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.INDIA_QA_QUEUE_API_KEY || '' },
      body: JSON.stringify({
        vertical: 'vat.law',
        task: 'review_oss_draft',
        customer_id: body.customer_id,
        oss_return_id: ossReturn.id,
        scheme: body.scheme,
        countries_covered: breakdown.length,
        total_vat_due,
      }),
    })
  } catch {/* non-fatal */}

  return NextResponse.json({
    oss_return: ossReturn,
    summary: {
      scheme: body.scheme,
      quarter: body.quarter,
      period_start: start,
      period_end: end,
      countries_covered: breakdown.length,
      total_vat_due,
      breakdown,
      next_step: 'India QA review · then file via the Irish ROS portal (OSS Union) or IOSS portal',
    },
  })
}
