// Submit a 9-box VAT return via HMRC MTD VAT API.
// Pro and Cross-Border tiers route through India QA first (must be qa_approved before HMRC submission).
// Essentials tier may submit directly once finalised by the customer.

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { createRouteClient } from '@/lib/supabase'
import { rateLimit, clientIp } from '@/lib/rate-limit'
import { submitNineBoxReturn, refreshAccessToken } from '@/lib/hmrc-mtd'
import type { HmrcNineBoxPayload } from '@/lib/hmrc-mtd'

const Body = z.object({
  vat_return_id: z.string().uuid(),
})

export async function POST(request: NextRequest) {
  // Rate limit: 10 HMRC submits/min per IP (authed write to a live filing path).
  const rl = rateLimit({ key: `returns-submit:${clientIp(request.headers)}`, limit: 10, windowSec: 60 })
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
  try {
    body = Body.parse(await request.json())
  } catch (e: any) {
    return NextResponse.json({ error: 'Invalid body', details: e.errors ?? String(e) }, { status: 400 })
  }

  // 1. Load the return + the owning customer record
  const { data: vatReturn, error: returnErr } = await supabase
    .from('vat_returns')
    .select('*, customer:vat_customers!inner(*)')
    .eq('id', body.vat_return_id)
    .single()

  if (returnErr || !vatReturn) {
    return NextResponse.json({ error: 'Return not found' }, { status: 404 })
  }
  if (vatReturn.customer.profile_id !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // 2. Status & QA gate
  if (vatReturn.status === 'submitted' || vatReturn.status === 'accepted') {
    return NextResponse.json({ error: `Already ${vatReturn.status}` }, { status: 409 })
  }
  if (!vatReturn.finalised) {
    return NextResponse.json({ error: 'Return must be finalised before submission (HMRC mandate)' }, { status: 400 })
  }

  // Tier vocabulary matches the vat_customers.tier check constraint in
  // sql_001 ('essentials' | 'pro' | 'cross_border') — NOT the drifted
  // no-underscore spelling (packet §5.5) which the DB would reject.
  const tier = vatReturn.customer.tier as 'essentials' | 'pro' | 'cross_border'
  const requiresIndiaQa = tier === 'pro' || tier === 'cross_border'
  if (requiresIndiaQa && vatReturn.india_qa_status !== 'approved') {
    // Push to India QA queue if not already pending
    if (vatReturn.india_qa_status !== 'pending') {
      await supabase.from('vat_returns').update({
        status: 'awaiting_qa',
        india_qa_status: 'pending',
      }).eq('id', vatReturn.id)

      try {
        await fetch(process.env.INDIA_QA_QUEUE_WEBHOOK || '', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': process.env.INDIA_QA_QUEUE_API_KEY || '',
          },
          body: JSON.stringify({
            vertical: 'vat.law',
            task: 'review_9_box_return',
            customer_id: vatReturn.customer.id,
            vat_return_id: vatReturn.id,
            period_key: vatReturn.period_key,
            tier,
          }),
        })
      } catch {/* India QA queue failure should not block the user — we already persisted awaiting_qa */}
    }
    return NextResponse.json({
      status: 'awaiting_qa',
      message: `${tier} tier requires India QA review before HMRC submission.`,
    }, { status: 202 })
  }

  // 3. Token freshness — refresh if expiring
  let accessToken = vatReturn.customer.hmrc_mtd_access_token_encrypted
  const expiresAt = vatReturn.customer.hmrc_mtd_token_expires_at
  if (!accessToken) {
    return NextResponse.json({ error: 'Customer has not connected HMRC MTD' }, { status: 412 })
  }
  if (expiresAt && new Date(expiresAt).getTime() < Date.now() + 60_000) {
    try {
      const fresh = await refreshAccessToken(vatReturn.customer.hmrc_mtd_refresh_token_encrypted)
      accessToken = fresh.access_token
      await supabase.from('vat_customers').update({
        hmrc_mtd_access_token_encrypted: fresh.access_token,
        hmrc_mtd_refresh_token_encrypted: fresh.refresh_token,
        hmrc_mtd_token_expires_at: fresh.expires_at,
      }).eq('id', vatReturn.customer.id)
    } catch (e: any) {
      return NextResponse.json({ error: 'HMRC token refresh failed', detail: String(e) }, { status: 502 })
    }
  }

  // 4. Build the 9-box payload
  const payload: HmrcNineBoxPayload = {
    periodKey: vatReturn.period_key,
    vatDueSales: Number(vatReturn.box1_vat_due_sales),
    vatDueAcquisitions: Number(vatReturn.box2_vat_due_acquisitions),
    totalVatDue: Number(vatReturn.box3_total_vat_due),
    vatReclaimedCurrPeriod: Number(vatReturn.box4_vat_reclaimed),
    netVatDue: Number(vatReturn.box5_net_vat_due),
    totalValueSalesExVAT: Math.round(Number(vatReturn.box6_total_sales_ex_vat)),
    totalValuePurchasesExVAT: Math.round(Number(vatReturn.box7_total_purchases_ex_vat)),
    totalValueGoodsSuppliedExVAT: Math.round(Number(vatReturn.box8_supplies_to_eu)),
    totalAcquisitionsExVAT: Math.round(Number(vatReturn.box9_acquisitions_from_eu)),
    finalised: true,
  }

  // 5. Submit to HMRC
  let receipt
  try {
    receipt = await submitNineBoxReturn(vatReturn.customer.vrn, accessToken, payload, request)
  } catch (e: any) {
    await supabase.from('vat_returns').update({
      status: 'rejected',
      rejection_reason: String(e),
    }).eq('id', vatReturn.id)
    return NextResponse.json({ error: 'HMRC submission failed', detail: String(e) }, { status: 502 })
  }

  // 6. Persist receipt
  const { data: updated, error: updateErr } = await supabase.from('vat_returns').update({
    status: 'submitted',
    submitted_at: new Date().toISOString(),
    hmrc_submission_form_bundle_number: receipt.formBundleNumber,
    hmrc_submission_payment_indicator: receipt.paymentIndicator,
    hmrc_submission_processing_date: receipt.processingDate,
  }).eq('id', vatReturn.id).select().single()

  if (updateErr) {
    console.error('vat_returns update failed:', updateErr.message)
    return NextResponse.json({ error: 'Submission succeeded but local update failed — contact support' }, { status: 500 })
  }

  return NextResponse.json({ vat_return: updated, hmrc_receipt: receipt })
}
