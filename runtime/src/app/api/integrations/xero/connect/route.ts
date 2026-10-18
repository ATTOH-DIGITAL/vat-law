// Xero OAuth2 — start authorisation flow.
// We build a Xero authorize URL with offline_access (for refresh token),
// accounting.transactions.read, accounting.settings.read scopes.
// State carries the customer_id so the callback can complete the link.

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createRouteClient } from '@/lib/supabase'
import crypto from 'crypto'

const XERO_AUTHORIZE = 'https://login.xero.com/identity/connect/authorize'

export async function GET(request: NextRequest) {
  const supabase = await createRouteClient()
  // getUser() validates the JWT server-side; getSession() only decodes the cookie.
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const customer_id = searchParams.get('customer_id')
  if (!customer_id) return NextResponse.json({ error: 'customer_id is required' }, { status: 400 })

  // Verify customer ownership
  const { data: customer } = await supabase
    .from('vat_customers').select('id, profile_id').eq('id', customer_id).single()
  if (!customer || customer.profile_id !== user.id) {
    return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
  }

  // State token — random + HMAC over customer_id for tamper-evidence
  const nonce = crypto.randomBytes(16).toString('hex')
  const stateBody = `${customer_id}.${nonce}.${Date.now()}`
  const sig = crypto
    .createHmac('sha256', process.env.JWT_SECRET || 'dev-secret')
    .update(stateBody).digest('hex').slice(0, 32)
  const state = `${stateBody}.${sig}`

  // Persist pending integration row so we can match the callback
  await supabase.from('integration_oauth_states').insert({
    provider: 'xero',
    customer_id,
    state,
    nonce,
    created_at: new Date().toISOString(),
  })

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.XERO_CLIENT_ID || '',
    redirect_uri: process.env.XERO_REDIRECT_URI || '',
    scope: process.env.XERO_SCOPES || 'offline_access accounting.transactions.read accounting.settings.read',
    state,
  })

  return NextResponse.redirect(`${XERO_AUTHORIZE}?${params.toString()}`)
}
