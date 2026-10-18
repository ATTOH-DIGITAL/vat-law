// Free, unauthenticated, 60-second £90k VAT-registration threshold check.
// This is the top-of-funnel acquisition tool (mirrors sole.tax's free MTD-eligibility check).
// Rolling 12-month taxable turnover is the test (VATA 1994 Sch 1 para 1).

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRouteClient } from '@/lib/supabase'
import { rateLimit, clientIp } from '@/lib/rate-limit'
import { VAT_REGISTRATION_THRESHOLD_GBP, VAT_DEREGISTRATION_THRESHOLD_GBP } from '@/types'

const Body = z.object({
  monthly_taxable_turnover_gbp: z.array(z.number().min(0)).length(12),
  email: z.string().email().optional(),
  expects_to_exceed_in_next_30_days: z.boolean().optional(),
  business_type: z.enum(['sole_trader', 'partnership', 'ltd', 'llp', 'other']).optional(),
  primary_sector: z.string().optional(),
  // Honeypot — hidden field humans never fill. Bots that stuff every input get
  // a normal-looking 200 with NO lead persisted (reject-silently pattern, same
  // as _site/functions/api/snap-lead.js).
  website: z.string().optional(),
})

export async function POST(request: Request) {
  // Public, unauthenticated top-of-funnel: cap at 20/min per IP so a bot can't
  // hammer the free check. Legitimate users never hit this.
  const rl = rateLimit({ key: `threshold:${clientIp(request.headers)}`, limit: 20, windowSec: 60 })
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many requests', retry_after_sec: rl.resetInSec },
      { status: 429, headers: { 'Retry-After': String(rl.resetInSec), 'X-RateLimit-Remaining': String(rl.remaining) } },
    )
  }

  let parsed
  try {
    parsed = Body.parse(await request.json())
  } catch (e: any) {
    return NextResponse.json({ error: 'Invalid body', details: e.errors ?? String(e) }, { status: 400 })
  }

  const { monthly_taxable_turnover_gbp, email, expects_to_exceed_in_next_30_days, business_type, primary_sector } = parsed

  const rolling_12_month_total = monthly_taxable_turnover_gbp.reduce((a, b) => a + b, 0)
  const months_above_threshold = monthly_taxable_turnover_gbp.reduce((c, m, i) => {
    const cumulative = monthly_taxable_turnover_gbp.slice(0, i + 1).reduce((a, b) => a + b, 0)
    return cumulative > VAT_REGISTRATION_THRESHOLD_GBP ? c + 1 : c
  }, 0)

  const must_register = rolling_12_month_total > VAT_REGISTRATION_THRESHOLD_GBP || expects_to_exceed_in_next_30_days === true
  const should_consider_deregistration = rolling_12_month_total < VAT_DEREGISTRATION_THRESHOLD_GBP
  const headroom = VAT_REGISTRATION_THRESHOLD_GBP - rolling_12_month_total
  const monthly_growth_to_breach = headroom > 0 ? headroom / 6 : 0   // rough headroom over a 6-month runway

  // Trigger date logic: 30-day rule — must register by end of the month following the month in which rolling 12-month exceeded
  let trigger_month_index: number | null = null
  let running = 0
  for (let i = 0; i < monthly_taxable_turnover_gbp.length; i++) {
    running += monthly_taxable_turnover_gbp[i]
    if (running > VAT_REGISTRATION_THRESHOLD_GBP) { trigger_month_index = i; break }
  }

  const result = {
    threshold_gbp: VAT_REGISTRATION_THRESHOLD_GBP,
    rolling_12_month_total_gbp: rolling_12_month_total,
    headroom_gbp: Math.max(0, headroom),
    months_above_threshold,
    must_register,
    should_consider_deregistration,
    monthly_growth_to_breach_gbp: Math.round(monthly_growth_to_breach),
    trigger_month_index,
    recommended_next_steps: must_register
      ? [
          'Register for VAT with HMRC within 30 days of the end of the month in which you exceeded £90,000 rolling 12-month',
          'Decide on accounting scheme (standard · cash · flat rate · annual)',
          'Choose MTD-recognised software (vat.law is on the HMRC recognised list)',
          'Connect your bookkeeping platform (Xero / QuickBooks / Sage / FreeAgent)',
        ]
      : expects_to_exceed_in_next_30_days
      ? [
          'You expect to exceed the threshold in the next 30 days — you must register before the end of that 30-day window',
          'Connect bookkeeping early to capture pre-registration input VAT (4 years on goods, 6 months on services)',
        ]
      : should_consider_deregistration
      ? [
          'Voluntary deregistration possible — your rolling 12-month is below £88,000',
          'Beware of input-VAT clawback on assets and stock held at deregistration',
        ]
      : [
          `You have approximately £${Math.max(0, headroom).toLocaleString('en-GB')} of headroom`,
          'Consider voluntary registration if your customers are VAT-registered (input VAT recovery)',
        ],
  }

  // Honeypot tripped → return the computed result but never persist the lead.
  const honeypotTripped = typeof parsed.website === 'string' && parsed.website.trim() !== ''

  // Best-effort log to leads table (non-fatal — public endpoint)
  if (email && !honeypotTripped) {
    try {
      const supabase = await createRouteClient()
      await supabase.from('threshold_check_leads').insert({
        email,
        rolling_12_month_total_gbp: rolling_12_month_total,
        must_register,
        business_type: business_type || null,
        primary_sector: primary_sector || null,
        checked_at: new Date().toISOString(),
      })
    } catch {
      // intentionally swallow — this endpoint is public and idempotent on the user side
    }
  }

  return NextResponse.json(result)
}
