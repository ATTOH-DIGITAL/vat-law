// Cross-vertical fan-in webhook.
// form.law · sole.tax · accounts.law · landlord.tax fire events here when one of
// their customers triggers a VAT-relevant signal. We translate the event into a
// vat.law alert / lead / pre-filled customer record.
//
// Auth: per-source HMAC signature in x-supreme-signature header.
// Body shape:
//   { source: 'form.law'|'sole.tax'|'accounts.law'|'landlord.tax',
//     event: string,
//     payload: object,
//     fired_at: ISO }

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import crypto from 'crypto'
import { createRouteClient } from '@/lib/supabase'

const SECRETS: Record<string, string | undefined> = {
  'form.law': process.env.FORM_LAW_WEBHOOK_SECRET,
  'sole.tax': process.env.SOLE_TAX_WEBHOOK_SECRET,
  'accounts.law': process.env.ACCOUNTS_LAW_WEBHOOK_SECRET,
  'landlord.tax': process.env.LANDLORD_TAX_WEBHOOK_SECRET,
}

function timingSafeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return crypto.timingSafeEqual(ab, bb)
}

export async function POST(request: NextRequest) {
  const raw = await request.text()
  let body: any
  try { body = JSON.parse(raw) }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const source = body.source as string | undefined
  const event = body.event as string | undefined
  if (!source || !event || !SECRETS[source]) {
    return NextResponse.json({ error: 'Unknown source' }, { status: 400 })
  }

  const expected = crypto
    .createHmac('sha256', SECRETS[source] as string)
    .update(raw)
    .digest('hex')
  const provided = request.headers.get('x-supreme-signature') || ''
  if (!timingSafeEqual(expected, provided)) {
    return NextResponse.json({ error: 'Bad signature' }, { status: 401 })
  }

  // Service-role client for cross-vertical writes (this is a server-to-server route)
  const supabase = await createRouteClient()

  // Persist raw event for audit
  await supabase.from('cross_vertical_events').insert({
    source,
    event,
    payload: body.payload || {},
    fired_at: body.fired_at || new Date().toISOString(),
    received_at: new Date().toISOString(),
  })

  // Route by event type → vat.law domain action
  switch (event) {
    case 'company_formed': {
      // form.law: a new UK company was incorporated. Stage a vat.law lead with
      // the directors' email so the threshold-watch can begin.
      const p = body.payload as { company_name: string; companies_house_number: string; director_email: string }
      await supabase.from('threshold_check_leads').insert({
        email: p.director_email,
        rolling_12_month_total_gbp: 0,
        must_register: false,
        business_type: 'ltd',
        primary_sector: null,
        source: 'form.law:company_formed',
        company_name: p.company_name,
        companies_house_number: p.companies_house_number,
        checked_at: new Date().toISOString(),
      })
      return NextResponse.json({ ok: true, action: 'staged_threshold_lead' })
    }
    case 'sole_trader_threshold_approaching': {
      // sole.tax: a sole trader is hitting £75k+. They will need VAT-registration shortly.
      const p = body.payload as { customer_id_sole_tax: string; email: string; rolling_12_month_gbp: number }
      await supabase.from('threshold_check_leads').insert({
        email: p.email,
        rolling_12_month_total_gbp: p.rolling_12_month_gbp,
        must_register: p.rolling_12_month_gbp > 90000,
        business_type: 'sole_trader',
        primary_sector: null,
        source: 'sole.tax:threshold_approaching',
        sole_tax_customer_id: p.customer_id_sole_tax,
        checked_at: new Date().toISOString(),
      })
      return NextResponse.json({ ok: true, action: 'cross_referred_from_sole_tax' })
    }
    case 'accounts_filed': {
      // accounts.law: company filed statutory accounts. If turnover > £90k, fire a registration alert.
      const p = body.payload as { customer_email: string; turnover_gbp: number; period_end: string }
      if (p.turnover_gbp > 90000) {
        await supabase.from('vat_alerts').insert({
          customer_id: null,
          severity: 'warning',
          category: 'threshold_crossed',
          message: `accounts.law filed accounts for ${p.customer_email} showing turnover £${p.turnover_gbp.toLocaleString('en-GB')} for period ending ${p.period_end}. VAT registration likely required.`,
          due_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
        })
      }
      return NextResponse.json({ ok: true, action: 'threshold_check_logged' })
    }
    case 'landlord_opted_to_tax': {
      // landlord.tax: a landlord opted to tax a commercial property. Now VAT applies on rent and CGS may trigger.
      const p = body.payload as { customer_email: string; property_address: string; option_date: string }
      await supabase.from('vat_alerts').insert({
        customer_id: null,
        severity: 'info',
        category: 'cgs_anniversary',
        message: `landlord.tax: option to tax exercised on ${p.property_address} effective ${p.option_date}. Capital Goods Scheme review recommended if >£250k.`,
        due_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      })
      return NextResponse.json({ ok: true, action: 'cgs_review_alert_raised' })
    }
    default:
      return NextResponse.json({ ok: true, action: 'event_logged_no_route' })
  }
}
