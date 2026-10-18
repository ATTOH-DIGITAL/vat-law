// Classify a batch of invoices for Domestic Reverse Charge (DRC) treatment.
// Calls Claude (Anthropic API) with a structured prompt. Low-confidence rows
// (<0.85) are routed to India QA. The classifier returns JSON only.
//
// DRC categories in scope (VATA 1994 s.55A + CIS DRC Order 2019):
//   - construction_drc (CIS DRC at 5% or 20%)
//   - mobile_phones · computer_chips · gas_electricity_wholesale ·
//     emissions_allowances · telecoms_wholesale
//   - standard (outside DRC scope)

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import Anthropic from '@anthropic-ai/sdk'
import { createRouteClient } from '@/lib/supabase'

const Body = z.object({
  customer_id: z.string().uuid(),
  invoice_ids: z.array(z.string().uuid()).min(1).max(200),
})

const CLASSIFIER_SYSTEM = `You are a UK VAT classifier specialised in Domestic Reverse Charge (DRC) rules.

You classify B2B invoices into ONE of these categories:
- standard                      (outside DRC — standard 20% / 5% / 0% applies)
- construction_drc              (CIS DRC: VATA 1994 s.55A; CIS DRC Order 2019; supplier and customer both CIS-registered; construction services as defined)
- mobile_phones                 (wholesale mobile phones > £5,000 cumulative — VAT (Section 55A) (Specified Goods) Order 2007)
- computer_chips                (wholesale computer chips — same Order)
- gas_electricity_wholesale     (wholesale gas / electricity supplies between B2B counterparties)
- emissions_allowances          (EU ETS / UK ETS emissions trading)
- telecoms_wholesale            (wholesale telecommunications services)

CRITICAL RULES:
1. End-user / consumer / final-customer rule disapplies CIS DRC even where supplier+customer are CIS-registered. Look for "end user" or "intermediary supplier" markers.
2. Mixed invoices: if ANY line is DRC, the whole invoice flips DRC under HMRC's anti-disaggregation guidance.
3. Confidence < 0.85 → set needs_india_qa = true. Be honest about uncertainty.
4. Output STRICT JSON only. No prose, no markdown fences.`

interface Classification {
  invoice_id: string
  category: string
  confidence_score: number
  rationale: string
  needs_india_qa: boolean
}

export async function POST(request: NextRequest) {
  const supabase = await createRouteClient()
  // getUser() validates the JWT server-side; getSession() only decodes the cookie.
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  let body
  try { body = Body.parse(await request.json()) }
  catch (e: any) { return NextResponse.json({ error: 'Invalid body', details: e.errors ?? String(e) }, { status: 400 }) }

  // Ownership check
  const { data: customer } = await supabase.from('vat_customers').select('id, profile_id, tier').eq('id', body.customer_id).single()
  if (!customer || customer.profile_id !== user.id) {
    return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
  }

  // Pull invoice rows
  const { data: invoices, error: invErr } = await supabase
    .from('vat_invoices').select('*')
    .eq('customer_id', body.customer_id)
    .in('id', body.invoice_ids)

  if (invErr || !invoices?.length) {
    return NextResponse.json({ error: 'Invoices not found' }, { status: 404 })
  }

  // Build classifier input — column-accurate against sql_001 vat_invoices
  // (§5.4 reconcile: the old field names counterparty_name/net_amount/
  // vat_amount/invoice_date exist in NO migration; these do).
  const slim = invoices.map((i: any) => ({
    invoice_id: i.id,
    direction: i.direction,
    counterparty: i.supplier_or_customer,
    counterparty_vat: i.supplier_vat_number,
    place_of_supply: i.place_of_supply,
    net: i.net,
    vat: i.vat,
    rate: i.vat_rate,
    treatment_hint: i.drc_classification,
    invoice_date: i.issue_date,
  }))

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const model = process.env.CLAUDE_MODEL_DEFAULT || 'claude-sonnet-4-6'

  let classifications: Classification[]
  try {
    const completion = await anthropic.messages.create({
      model,
      max_tokens: 4096,
      system: CLASSIFIER_SYSTEM,
      messages: [{
        role: 'user',
        content: `Classify each invoice below. Return JSON array with shape: {invoice_id, category, confidence_score, rationale, needs_india_qa}.\n\nInvoices:\n${JSON.stringify(slim, null, 2)}`,
      }],
    })
    const text = completion.content[0].type === 'text' ? completion.content[0].text : ''
    const jsonStart = text.indexOf('[')
    const jsonEnd = text.lastIndexOf(']')
    classifications = JSON.parse(text.slice(jsonStart, jsonEnd + 1))
  } catch (e: any) {
    return NextResponse.json({ error: 'Classifier failed', detail: String(e) }, { status: 502 })
  }

  // Persist DRC assignments into the canonical vat_drc_assignments table
  // (§5.4 reconcile, column-accurate: category->verdict mapping onto the
  // sql_001 check ('drc','standard','zero','manual_review'), rationale->
  // reasoning, confidence_score->confidence, needs_india_qa->
  // routes_to_india_qa; the classifier's regime detail keeps its own
  // additive `category` column via sql_009. Unknown/hallucinated categories
  // are normalised to verdict='manual_review' + India-QA routing in-app.)
  const KNOWN_DRC_CATEGORIES = new Set([
    'construction_drc', 'mobile_phones', 'computer_chips',
    'gas_electricity_wholesale', 'emissions_allowances', 'telecoms_wholesale',
  ])
  const verdictFor = (category: string): 'drc' | 'standard' | 'manual_review' =>
    category === 'standard' ? 'standard'
    : KNOWN_DRC_CATEGORIES.has(category) ? 'drc'
    : 'manual_review'
  const needsQa = (c: Classification) =>
    c.needs_india_qa || c.confidence_score < 0.85 || verdictFor(c.category) === 'manual_review'

  const rows = classifications.map(c => ({
    customer_id: body.customer_id,
    invoice_id: c.invoice_id,
    category: c.category,
    verdict: verdictFor(c.category),
    reasoning: c.rationale,
    confidence: c.confidence_score,
    routes_to_india_qa: needsQa(c),
  }))
  const { data: persisted, error: persistErr } = await supabase
    .from('vat_drc_assignments').insert(rows).select()
  if (persistErr) {
    console.error('vat_drc_assignments persist failed:', persistErr.message)
    return NextResponse.json({ error: 'Could not persist classifications' }, { status: 500 })
  }

  // Update invoice records with chosen category + classifier metadata
  // (drc_category / drc_classified_at / drc_classified_by added in sql_009)
  for (const c of classifications) {
    await supabase.from('vat_invoices').update({
      drc_category: c.category,
      drc_classified_at: new Date().toISOString(),
      drc_classified_by: needsQa(c) ? 'india_qa' : 'ai',
    }).eq('id', c.invoice_id)
  }

  const flagged = persisted?.filter((r: any) => r.routes_to_india_qa) ?? []

  // Fan to India QA queue if any flagged
  if (flagged.length) {
    try {
      await fetch(process.env.INDIA_QA_QUEUE_WEBHOOK || '', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.INDIA_QA_QUEUE_API_KEY || '' },
        body: JSON.stringify({
          vertical: 'vat.law',
          task: 'review_drc_classification',
          customer_id: body.customer_id,
          tier: customer.tier,
          drc_assignment_ids: flagged.map((f: any) => f.id),
        }),
      })
    } catch {/* non-fatal */}
  }

  return NextResponse.json({
    classified: persisted?.length ?? 0,
    flagged_for_india_qa: flagged.length,
    breakdown: classifications.reduce<Record<string, number>>((acc, c) => {
      acc[c.category] = (acc[c.category] || 0) + 1
      return acc
    }, {}),
  })
}
