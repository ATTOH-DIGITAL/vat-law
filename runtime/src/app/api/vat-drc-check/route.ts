// Domestic Reverse Charge (DRC) eligibility check — Pro and Cross-Border tiers only.
//
// DRC applies under VATA 1994 s.55A to:
//   1. Construction services under CIS (Construction Industry Scheme) — operative since 1 Mar 2021.
//      Both supplier AND customer must be CIS-registered; end-users disapply DRC.
//   2. Wholesale telecoms services (VAT (Section 55A) (Specified Services) Order 2007).
//   3. Certain renewable energy supplies (emissions allowances, gas/electricity wholesale).
//
// This endpoint is a lightweight eligibility check (not an invoice classifier).
// For bulk invoice classification, use /api/drc/classify-batch.

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { supabaseAdmin, tierAllows } from '@/lib/supabase'
import type { VatTier } from '@/lib/supabase'

const CONSTRUCTION_PATTERN =
  /construction|build|install|demolish|demolition|roofing|plumbing|electrical\s+work|plastering|concrete|groundwork|scaffolding|brickwork|joinery|carpentry|glazing|landscaping|drainage|piling/i

const TELECOMS_PATTERN =
  /wholesale\s+telecom|telecoms?\s+wholesale|bandwidth|interconnect|carrier\s+service|cli\s+route/i

const RENEWABLE_ENERGY_PATTERN =
  /emissions?\s+allowance|carbon\s+credit|ets\s+unit|wholesale\s+gas|wholesale\s+electricity|electricity\s+wholesale|gas\s+wholesale/i

const Body = z.object({
  business_id:        z.string(),
  service_description: z.string().min(1).max(2000),
  is_cis_registered:  z.boolean().optional(),
})

export async function POST(request: NextRequest) {
  // Auth check
  const authHeader = request.headers.get('authorization')
  const token = authHeader?.replace('Bearer ', '')
  if (!token) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token)
  if (authErr || !user) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  // Tier check — DRC check requires pro or cross_border.
  // §5.4 reconcile: tier lives on the canonical vat_customers table (sql_001,
  // keyed by profile_id = auth user id) — the drifted vat_profiles table was
  // never created by any migration.
  const { data: profile } = await supabaseAdmin
    .from('vat_customers')
    .select('tier')
    .eq('profile_id', user.id)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  const tier = (profile?.tier ?? 'trial') as VatTier

  if (!tierAllows(tier, 'drc_check')) {
    return NextResponse.json(
      {
        error: 'Feature not available on your plan',
        required_tier: 'pro',
        upgrade_url: '/upgrade',
      },
      { status: 403 },
    )
  }

  let body: z.infer<typeof Body>
  try {
    body = Body.parse(await request.json())
  } catch (e: any) {
    return NextResponse.json({ error: 'Invalid body', details: e.errors ?? String(e) }, { status: 400 })
  }

  const { business_id, service_description, is_cis_registered } = body

  // Pattern matching
  const construction_match  = CONSTRUCTION_PATTERN.test(service_description)
  const telecoms_match      = TELECOMS_PATTERN.test(service_description)
  const renewable_match     = RENEWABLE_ENERGY_PATTERN.test(service_description)

  // DRC applies to construction only when both supplier and customer are CIS-registered.
  // If is_cis_registered is not provided we flag potential rather than definite.
  const drc_applies =
    (is_cis_registered === true && construction_match) ||
    telecoms_match ||
    renewable_match

  let reason: string
  let action: string

  if (is_cis_registered === true && construction_match) {
    reason =
      'Service description matches construction services under CIS. Both parties must be CIS-registered for DRC to apply. CIS DRC has been operative since 1 March 2021 (VATA 1994 s.55A).'
    action =
      'Do NOT charge VAT on your invoice. State "Reverse charge: customer to pay the VAT to HMRC" on the invoice. Customer self-accounts at the applicable rate (20% or 5%).'
  } else if (construction_match && is_cis_registered !== true) {
    reason =
      'Service description matches construction services. DRC may apply if both supplier and customer are CIS-registered. You must verify your customer\'s CIS status before issuing the invoice.'
    action =
      'Confirm your customer\'s CIS registration status. If both parties are CIS-registered, apply DRC. If the customer is an end-user or intermediary supplier, standard VAT applies.'
  } else if (telecoms_match) {
    reason =
      'Service description matches wholesale telecoms services. DRC applies to wholesale telecommunications supplies between VAT-registered businesses under the VAT (Section 55A) (Specified Services) Order 2007.'
    action =
      'Do NOT charge VAT. Apply reverse charge. State "Reverse charge applies" on the invoice. Customer self-accounts.'
  } else if (renewable_match) {
    reason =
      'Service description matches wholesale gas/electricity or emissions allowances. DRC may apply under VATA 1994 s.55A or the VAT (Specified Goods and Services) Order.'
    action =
      'Verify the specific supply type against HMRC guidance. If DRC applies, do NOT charge VAT — customer accounts for it.'
  } else {
    reason =
      'No DRC indicators detected in service description. Standard VAT treatment likely applies (20% on taxable supplies).'
    action =
      'Charge VAT at the applicable rate (20% standard, 5% reduced, 0% zero-rated). If in doubt, seek specialist advice before issuing.'
  }

  const india_qa_recommended = drc_applies

  const result = {
    business_id,
    drc_applies,
    construction_match,
    telecoms_match,
    renewable_match,
    is_cis_registered: is_cis_registered ?? null,
    reason,
    action,
    india_qa_recommended,
    note: 'DRC classification should be reviewed by a qualified VAT adviser before invoicing.',
    checked_at: new Date().toISOString(),
  }

  return NextResponse.json(result)
}
