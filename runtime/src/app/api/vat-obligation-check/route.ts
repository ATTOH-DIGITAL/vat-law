// VAT obligation check — AUTHENTICATED (all paid tiers + trial, but never
// anonymous). Gated in-route by getAuthedUser (validated auth.getUser — the
// middleware's old getSession check was forgeable and never actually ran for
// API paths). The previous "all tiers including trial" comment described tier
// breadth, not auth — this route writes via the service-role client and must
// not be callable without a validated user.
// UK VAT 2026/27 thresholds:
//   Registration: £90,000 rolling 12-month taxable turnover
//   Deregistration: £88,000
//   Points-based penalty regime (Jan 2023+):
//     Quarterly filer: 4 points → £200 fixed penalty
//     Monthly filer:   5 points → £200 fixed penalty
//     Annual filer:    2 points → £200 fixed penalty
//   LPP1 (April 2025): 3% on day 15 + further 3% on day 30 of outstanding tax
//   LPP2: 10% per annum (daily rate) from day 31

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { getAuthedUser } from '@/lib/auth'
import { rateLimit, clientIp } from '@/lib/rate-limit'

const VAT_REGISTRATION_THRESHOLD = 90000
const VAT_DEREGISTRATION_THRESHOLD = 88000
const REGISTRATION_APPROACHING_THRESHOLD = 80000

const PENALTY_POINT_THRESHOLDS: Record<string, number> = {
  quarterly: 4,
  monthly:   5,
  annual:    2,
}

// Filing period days: MTD returns are due 1 calendar month + 7 days after period end.
// Monthly ≈ 37 days, quarterly ≈ 37 days, annual ≈ 365+37 days but we track just the 37-day window.
const FILING_PERIOD_DAYS: Record<string, number> = {
  monthly:   37,
  quarterly: 37,
  annual:    365,
}

const Body = z.object({
  business_id:           z.string(),
  turnover_12m:          z.number().min(0),
  vat_registered:        z.boolean(),
  filing_frequency:      z.enum(['monthly', 'quarterly', 'annual']),
  last_return_submitted: z.string().optional(),
})

type PenaltyPointRisk = 'high' | 'medium' | 'low' | 'none'

export async function POST(request: NextRequest) {
  // Rate limit: 30/min per IP (authed read-heavy check, service-role write).
  const rl = rateLimit({ key: `obligation:${clientIp(request.headers)}`, limit: 30, windowSec: 60 })
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many requests', retry_after_sec: rl.resetInSec },
      { status: 429, headers: { 'Retry-After': String(rl.resetInSec), 'X-RateLimit-Remaining': String(rl.remaining) } },
    )
  }

  // Validated-user gate first — never rely on middleware getSession alone.
  const auth = await getAuthedUser()
  if ('response' in auth) return auth.response
  const userId = auth.user.id

  let body: z.infer<typeof Body>
  try {
    body = Body.parse(await request.json())
  } catch (e: any) {
    return NextResponse.json({ error: 'Invalid body', details: e?.errors ?? 'Malformed JSON' }, { status: 400 })
  }

  const {
    business_id,
    turnover_12m,
    vat_registered,
    filing_frequency,
    last_return_submitted,
  } = body

  // Registration obligation logic
  const registration_required  = turnover_12m >= VAT_REGISTRATION_THRESHOLD && !vat_registered
  const registration_approaching = turnover_12m >= REGISTRATION_APPROACHING_THRESHOLD && !vat_registered

  // Days since last submitted return
  const days_since_last_return: number | null = last_return_submitted
    ? Math.round((Date.now() - new Date(last_return_submitted).getTime()) / 86_400_000)
    : null

  // Potential lateness
  const filing_window = FILING_PERIOD_DAYS[filing_frequency]
  const potentially_late =
    days_since_last_return !== null && days_since_last_return > filing_window

  // Penalty point risk assessment
  let penalty_point_risk: PenaltyPointRisk = 'none'
  if (potentially_late && days_since_last_return !== null) {
    const overdue_days = days_since_last_return - filing_window
    if (overdue_days > 60) {
      penalty_point_risk = 'high'
    } else if (overdue_days > 21) {
      penalty_point_risk = 'medium'
    } else {
      penalty_point_risk = 'low'
    }
  }

  // Recommendations
  const recommendations: string[] = []

  if (registration_required) {
    recommendations.push(
      'You must register for VAT — your rolling 12-month taxable turnover has exceeded £90,000.',
      'Register within 30 days of the end of the month in which the threshold was crossed.',
      'Choose your accounting scheme (standard, cash, flat-rate or annual) before registering.',
    )
  } else if (registration_approaching) {
    recommendations.push(
      'Your turnover is within £10,000 of the £90,000 registration threshold — monitor closely.',
      'Consider voluntary registration now if your customers are VAT-registered (reclaim input VAT).',
    )
  }

  if (potentially_late) {
    const pts = PENALTY_POINT_THRESHOLDS[filing_frequency]
    recommendations.push(
      `Your last return appears overdue (${days_since_last_return} days since submission, window is ${filing_window} days).`,
      `Under the points-based penalty regime, ${filing_frequency} filers receive 1 point per late return. At ${pts} points you face a £200 fixed penalty.`,
      'Late Payment Penalty (LPP1): 3% of outstanding tax if unpaid by day 15, additional 3% by day 30.',
      'LPP2 (day 31+): 10% per annum accruing daily on any outstanding balance.',
    )
  }

  if (penalty_point_risk === 'high') {
    recommendations.push(
      'HIGH PENALTY RISK: Submit any overdue returns immediately to avoid further penalty points.',
      'Request a Time to Pay arrangement from HMRC if you cannot clear the outstanding balance in full.',
    )
  }

  if (vat_registered && !potentially_late && recommendations.length === 0) {
    recommendations.push(
      'No immediate compliance action required.',
      'Next step: connect your bookkeeping platform to automate digital-link record-keeping under MTD.',
    )
  }

  const result = {
    business_id,
    registration_required,
    registration_approaching,
    turnover_12m,
    threshold: VAT_REGISTRATION_THRESHOLD,
    deregistration_threshold: VAT_DEREGISTRATION_THRESHOLD,
    potentially_late,
    days_since_last_return,
    filing_window_days: filing_window,
    penalty_point_risk,
    penalty_point_threshold: PENALTY_POINT_THRESHOLDS[filing_frequency],
    recommendations,
    checked_at: new Date().toISOString(),
  }

  // Scope the service-role write to the caller: only persist business_id if
  // the caller provably owns it via vat_customers (id → profile_id chain in
  // sql_001_vat_law_init.sql). Otherwise drop it and keep the validated user id.
  // Schema: vat_obligation_checks is created by
  // supabase_migrations/sql_003_vat_obligation_checks.sql (business_id uuid
  // nullable FK, user_id uuid not null, RLS owner-scoped SELECT).
  let owned_business_id: string | null = null
  const { data: ownedCustomer } = await supabaseAdmin
    .from('vat_customers')
    .select('id')
    .eq('id', business_id)
    .eq('profile_id', userId)
    .maybeSingle()
  if (ownedCustomer) owned_business_id = ownedCustomer.id

  // Best-effort persist (non-fatal)
  const { error: persistErr } = await supabaseAdmin.from('vat_obligation_checks').insert({
    business_id: owned_business_id,
    user_id: userId,
    turnover_12m,
    vat_registered,
    filing_frequency,
    registration_required,
    registration_approaching,
    potentially_late,
    penalty_point_risk,
    checked_at: result.checked_at,
  })
  if (persistErr) {
    // intentionally non-fatal — the check result is still valid without the log
    console.warn('vat_obligation_checks persist failed:', persistErr.message)
  }

  return NextResponse.json(result)
}
