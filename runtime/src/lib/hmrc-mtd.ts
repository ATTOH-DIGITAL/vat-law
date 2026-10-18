// HMRC MTD VAT API client
// Docs: https://developer.service.hmrc.gov.uk/api-documentation/docs/api/service/vat-api
//
// Three groups of calls in scope for vat.law:
//   1. OAuth2 authorization code flow (per-customer grant — read:vat write:vat scopes)
//   2. Obligation poll (GET /organisations/vat/{vrn}/obligations) — what periods are due
//   3. Submit return (POST /organisations/vat/{vrn}/returns) — 9-box submission
//
// Every call requires the HMRC "fraud prevention headers" (Gov-Client-* and Gov-Vendor-*)
// or HMRC will reject with WAF_BLOCKED in production.

import type { NextRequest } from 'next/server'

export interface HmrcTokens {
  access_token: string
  refresh_token: string
  expires_at: string          // ISO timestamp
  scope: string
}

export interface HmrcObligation {
  start: string               // YYYY-MM-DD
  end: string                 // YYYY-MM-DD
  due: string                 // YYYY-MM-DD
  status: 'O' | 'F'           // Open / Fulfilled
  periodKey: string           // e.g. "24A1"
  received?: string           // YYYY-MM-DD if fulfilled
}

export interface HmrcNineBoxPayload {
  periodKey: string
  vatDueSales: number
  vatDueAcquisitions: number
  totalVatDue: number
  vatReclaimedCurrPeriod: number
  netVatDue: number
  totalValueSalesExVAT: number
  totalValuePurchasesExVAT: number
  totalValueGoodsSuppliedExVAT: number
  totalAcquisitionsExVAT: number
  finalised: boolean
}

export interface HmrcSubmissionReceipt {
  processingDate: string
  paymentIndicator: 'DD' | 'BANK' | null
  formBundleNumber: string
  chargeRefNumber?: string
}

const BASE = process.env.HMRC_MTD_BASE_URL || 'https://test-api.service.hmrc.gov.uk'

// ---- Fraud prevention headers (mandatory for live production) ------------------

export function fraudPreventionHeaders(req: NextRequest | null): Record<string, string> {
  const ua = req?.headers.get('user-agent') || 'vat.law-server'
  const ip = (req?.headers.get('x-forwarded-for') || '127.0.0.1').split(',')[0].trim()
  return {
    'Gov-Client-Connection-Method': 'WEB_APP_VIA_SERVER',
    'Gov-Client-Public-IP': ip,
    'Gov-Client-Public-Port': '443',
    'Gov-Client-Device-ID': req?.headers.get('x-vatlaw-device-id') || 'srv-vatlaw',
    'Gov-Client-User-IDs': `vatlaw=${req?.headers.get('x-vatlaw-user-id') || 'unknown'}`,
    'Gov-Client-Timezone': 'UTC+00:00',
    'Gov-Client-User-Agent': ua,
    'Gov-Vendor-Version': `vat-law=${process.env.HMRC_FRAUD_PREVENTION_VENDOR_VERSION || '0.1.0'}`,
    'Gov-Vendor-Product-Name': process.env.HMRC_FRAUD_PREVENTION_VENDOR_PRODUCT_NAME || 'vat.law',
    'Gov-Vendor-Public-IP': ip,
  }
}

// ---- OAuth ---------------------------------------------------------------------

export function buildAuthorizeUrl(state: string): string {
  const u = new URL(`${BASE}/oauth/authorize`)
  u.searchParams.set('response_type', 'code')
  u.searchParams.set('client_id', process.env.HMRC_MTD_CLIENT_ID || '')
  u.searchParams.set('scope', process.env.HMRC_MTD_SCOPES || 'read:vat write:vat')
  u.searchParams.set('redirect_uri', process.env.HMRC_MTD_REDIRECT_URI || '')
  u.searchParams.set('state', state)
  return u.toString()
}

export async function exchangeCodeForToken(code: string): Promise<HmrcTokens> {
  const res = await fetch(`${BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: process.env.HMRC_MTD_CLIENT_ID || '',
      client_secret: process.env.HMRC_MTD_CLIENT_SECRET || '',
      redirect_uri: process.env.HMRC_MTD_REDIRECT_URI || '',
    }),
  })
  if (!res.ok) throw new Error(`HMRC token exchange failed: ${res.status}`)
  const j = await res.json()
  return {
    access_token: j.access_token,
    refresh_token: j.refresh_token,
    expires_at: new Date(Date.now() + (j.expires_in - 60) * 1000).toISOString(),
    scope: j.scope,
  }
}

export async function refreshAccessToken(refresh_token: string): Promise<HmrcTokens> {
  const res = await fetch(`${BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token,
      client_id: process.env.HMRC_MTD_CLIENT_ID || '',
      client_secret: process.env.HMRC_MTD_CLIENT_SECRET || '',
    }),
  })
  if (!res.ok) throw new Error(`HMRC refresh failed: ${res.status}`)
  const j = await res.json()
  return {
    access_token: j.access_token,
    refresh_token: j.refresh_token,
    expires_at: new Date(Date.now() + (j.expires_in - 60) * 1000).toISOString(),
    scope: j.scope,
  }
}

// ---- VAT API endpoints ---------------------------------------------------------

async function vatGet<T>(path: string, accessToken: string, req: NextRequest | null): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.hmrc.1.0+json',
      ...fraudPreventionHeaders(req),
    },
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`HMRC GET ${path} → ${res.status}: ${body}`)
  }
  return res.json()
}

async function vatPost<T>(path: string, accessToken: string, body: unknown, req: NextRequest | null): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.hmrc.1.0+json',
      'Content-Type': 'application/json',
      ...fraudPreventionHeaders(req),
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const errBody = await res.text()
    throw new Error(`HMRC POST ${path} → ${res.status}: ${errBody}`)
  }
  return res.json()
}

export async function pollObligations(
  vrn: string,
  accessToken: string,
  opts: { from?: string; to?: string; status?: 'O' | 'F' } = {},
  req: NextRequest | null = null,
): Promise<HmrcObligation[]> {
  const qs = new URLSearchParams()
  if (opts.from) qs.set('from', opts.from)
  if (opts.to) qs.set('to', opts.to)
  if (opts.status) qs.set('status', opts.status)
  const path = `/organisations/vat/${vrn}/obligations${qs.toString() ? `?${qs}` : ''}`
  const j = await vatGet<{ obligations: HmrcObligation[] }>(path, accessToken, req)
  return j.obligations || []
}

export async function submitNineBoxReturn(
  vrn: string,
  accessToken: string,
  payload: HmrcNineBoxPayload,
  req: NextRequest | null = null,
): Promise<HmrcSubmissionReceipt> {
  if (!payload.finalised) {
    throw new Error('HMRC requires finalised=true to accept a VAT return submission')
  }
  return vatPost<HmrcSubmissionReceipt>(`/organisations/vat/${vrn}/returns`, accessToken, payload, req)
}

export async function retrieveSubmittedReturn(
  vrn: string,
  periodKey: string,
  accessToken: string,
  req: NextRequest | null = null,
): Promise<HmrcNineBoxPayload> {
  return vatGet<HmrcNineBoxPayload>(
    `/organisations/vat/${vrn}/returns/${encodeURIComponent(periodKey)}`,
    accessToken,
    req,
  )
}

export async function retrieveLiabilities(
  vrn: string,
  from: string,
  to: string,
  accessToken: string,
  req: NextRequest | null = null,
) {
  return vatGet(`/organisations/vat/${vrn}/liabilities?from=${from}&to=${to}`, accessToken, req)
}

export async function retrievePayments(
  vrn: string,
  from: string,
  to: string,
  accessToken: string,
  req: NextRequest | null = null,
) {
  return vatGet(`/organisations/vat/${vrn}/payments?from=${from}&to=${to}`, accessToken, req)
}
