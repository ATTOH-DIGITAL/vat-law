import 'server-only'
import { timingSafeEqual } from 'node:crypto'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const publicUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL!

/**
 * Validates the caller's JWT against the auth server. getSession() merely
 * decodes the cookie without verifying the signature and MUST NOT gate
 * server-side writes. Same pattern as cryptoplanet/runtime/src/lib/auth.ts.
 */
export async function getAuthedUser(): Promise<
  | { user: { id: string } }
  | { response: NextResponse }
> {
  const cookieStore = await cookies()
  const supabase = createServerClient(publicUrl, anonKey, {
    cookies: {
      get(name: string) { return cookieStore.get(name)?.value },
      set() {},
      remove() {},
    },
  })
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) {
    return { response: NextResponse.json({ error: 'Unauthorised' }, { status: 401 }) }
  }
  return { user: { id: user.id } }
}

/** Constant-time string compare (SECURITY.md §3 — never ===/!== on secrets). */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

/**
 * Dual-mode gate for agent endpoints: a server-to-server caller (n8n cron)
 * presents the shared secret in `x-agent-secret`; otherwise the caller must
 * hold a valid user session (the dashboard UI). If the secret env is unset
 * the agent path is DISABLED (fail closed) — never an open endpoint.
 */
export async function requireAgentOrUser(
  request: NextRequest,
  secretEnv: string,
): Promise<{ caller: 'agent' } | { caller: 'user'; userId: string } | { response: NextResponse }> {
  const configured = process.env[secretEnv]
  const presented = request.headers.get('x-agent-secret')
  if (configured && presented && safeEqual(presented, configured)) {
    return { caller: 'agent' }
  }
  const auth = await getAuthedUser()
  if ('response' in auth) return auth
  return { caller: 'user', userId: auth.user.id }
}

export { safeEqual }
