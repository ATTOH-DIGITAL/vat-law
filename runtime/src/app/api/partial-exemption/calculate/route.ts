// Partial Exemption — standard method calculation (VAT Notice 706).
// Special methods require HMRC approval; if customer has a special method assigned,
// we still capture the inputs and return the standard-method result for comparison.
//
// Standard method:
//   recovery_pct = ceil( taxable_supplies / (taxable_supplies + exempt_supplies) * 100 )
//   recoverable_residual = residual_input * recovery_pct / 100
//   total_recoverable = directly_attributable_taxable + recoverable_residual
//
// De minimis: input tax attributable to exempt supplies is recoverable if
//   <= £625/mo on average AND <= 50% of total input tax.

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { createRouteClient, tierAllows } from '@/lib/supabase'
import type { VatTier } from '@/lib/supabase'
import { DE_MINIMIS_MONTHLY_GBP, DE_MINIMIS_PERCENTAGE_PCT } from '@/types'

const Body = z.object({
  customer_id: z.string().uuid(),
  period_start: z.string(),
  period_end: z.string(),
  taxable_supplies: z.number().min(0),
  exempt_supplies: z.number().min(0),
  directly_attributable_taxable_input: z.number().min(0),
  directly_attributable_exempt_input: z.number().min(0),
  residual_input: z.number().min(0),
  method: z.enum(['standard', 'special']).default('standard'),
  is_annual_adjustment: z.boolean().default(false),
})

export async function POST(request: NextRequest) {
  const supabase = await createRouteClient()
  // getUser() validates the JWT server-side; getSession() only decodes the cookie.
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  let body
  try { body = Body.parse(await request.json()) }
  catch (e: any) { return NextResponse.json({ error: 'Invalid body', details: e.errors ?? String(e) }, { status: 400 }) }

  // Ownership check
  const { data: customer, error: custErr } = await supabase
    .from('vat_customers').select('*').eq('id', body.customer_id).single()
  if (custErr || !customer || customer.profile_id !== user.id) {
    return NextResponse.json({ error: 'Customer not found or forbidden' }, { status: 404 })
  }

  // Tier gate (folded in from the deleted duplicate /api/vat-partial-exemption
  // route — §5.4 one canonical route per capability): partial exemption is a
  // Pro / Cross-Border feature. Tier lives on the canonical vat_customers row.
  const tier = (customer.tier ?? 'trial') as VatTier
  if (!tierAllows(tier, 'partial_exemption')) {
    return NextResponse.json(
      { error: 'Feature not available on your plan', required_tier: 'pro', upgrade_url: '/upgrade' },
      { status: 403 },
    )
  }

  const total_supplies = body.taxable_supplies + body.exempt_supplies
  const raw_pct = total_supplies > 0 ? (body.taxable_supplies / total_supplies) * 100 : 0
  // Standard method rounds UP to next whole percentage if total residual <= £400k pa
  // (otherwise rounded to 2 d.p.). We pick the conservative simple ceil here.
  const recovery_percentage = Math.min(100, Math.ceil(raw_pct))
  const recoverable_residual_input = +(body.residual_input * recovery_percentage / 100).toFixed(2)
  const total_recoverable_input = +(body.directly_attributable_taxable_input + recoverable_residual_input).toFixed(2)

  // De minimis test
  const total_input = body.directly_attributable_taxable_input + body.directly_attributable_exempt_input + body.residual_input
  const exempt_input_total = body.directly_attributable_exempt_input + (body.residual_input - recoverable_residual_input)
  // months in the period
  const ms = new Date(body.period_end).getTime() - new Date(body.period_start).getTime()
  const months = Math.max(1, Math.round(ms / (1000 * 60 * 60 * 24 * 30.4375)))
  const monthly_exempt_input = exempt_input_total / months
  const de_minimis_passed =
    monthly_exempt_input <= DE_MINIMIS_MONTHLY_GBP &&
    (total_input === 0 ? true : (exempt_input_total / total_input) * 100 <= DE_MINIMIS_PERCENTAGE_PCT)

  const final_recoverable_input = de_minimis_passed ? total_input : total_recoverable_input

  const de_minimis_reason = de_minimis_passed
    ? `Passed Notice 706 §11: exempt input £${monthly_exempt_input.toFixed(2)}/mo <= £${DE_MINIMIS_MONTHLY_GBP}/mo AND <= ${DE_MINIMIS_PERCENTAGE_PCT}% of total input tax`
    : `Failed Notice 706 §11: exempt input £${monthly_exempt_input.toFixed(2)}/mo vs £${DE_MINIMIS_MONTHLY_GBP}/mo limit and/or > ${DE_MINIMIS_PERCENTAGE_PCT}% of total input tax`

  // India QA recommended for edge cases (folded in from the deleted duplicate
  // route): recovery outside 10-90% is territory where the standard method may
  // not give a fair and reasonable result.
  const india_qa_recommended = recovery_percentage < 10 || recovery_percentage > 90

  // Persist into the canonical vat_partial_exemption_records table (§5.4
  // reconcile, column-accurate against sql_001: recovery_percentage->
  // recoverable_percentage, directly_attributable_*_input->
  // directly_attributable_*, residual_input->residual_input_tax,
  // recoverable_residual_input->recoverable_residual, de_minimis_passed->
  // de_minimis_pass, annual_adjustment_applied->is_annual_adjustment; the
  // NOT NULL period label and total_input_tax are now written; the derived
  // total_recoverable_input stays response-only — canonical recomputes it from
  // directly_attributable_taxable + recoverable_residual (+ de minimis)).
  const { data: record, error: insertErr } = await supabase
    .from('vat_partial_exemption_records')
    .insert({
      customer_id: body.customer_id,
      period: `${body.period_start}..${body.period_end}`,
      period_start: body.period_start,
      period_end: body.period_end,
      method: body.method,
      taxable_supplies: body.taxable_supplies,
      exempt_supplies: body.exempt_supplies,
      total_input_tax: total_input,
      directly_attributable_taxable: body.directly_attributable_taxable_input,
      directly_attributable_exempt: body.directly_attributable_exempt_input,
      residual_input_tax: body.residual_input,
      recoverable_percentage: recovery_percentage,
      recoverable_residual: recoverable_residual_input,
      exempt_input_tax_recovered: de_minimis_passed ? +exempt_input_total.toFixed(2) : 0,
      de_minimis_pass: de_minimis_passed,
      de_minimis_reason,
      is_annual_adjustment: body.is_annual_adjustment,
    })
    .select()
    .single()

  if (insertErr) {
    console.error('vat_partial_exemption_records insert failed:', insertErr.message)
    return NextResponse.json({ error: 'Could not save calculation' }, { status: 500 })
  }

  return NextResponse.json({
    record,
    summary: {
      raw_recovery_percentage: +raw_pct.toFixed(4),
      recovery_percentage,
      recoverable_residual_input,
      total_recoverable_input: final_recoverable_input,
      de_minimis_passed,
      india_qa_recommended,
      months_in_period: months,
      monthly_exempt_input: +monthly_exempt_input.toFixed(2),
      notes: de_minimis_passed
        ? 'De minimis passed — all input VAT recoverable in this period. Annual review still required.'
        : body.method === 'special'
        ? 'Customer has an HMRC-approved special method. Recovery figure shown is the standard-method comparison; apply your approved method for the actual return.'
        : 'Standard method applied. Annual adjustment must be calculated at year-end based on full-year supply mix.',
    },
  })
}
