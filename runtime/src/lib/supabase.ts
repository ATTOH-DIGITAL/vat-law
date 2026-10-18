import 'server-only'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createServerClient as createSsrServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

// @supabase/auth-helpers-nextjs is deprecated (and 0.15.x no longer exports the
// legacy helpers this file used to re-export) — everything here is @supabase/ssr.
// Browser client lives in supabase-browser.ts so client components never load
// this module (it builds the service-role admin client at module load).

const url = process.env.SUPABASE_URL!
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const publicUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL!

/**
 * Session-aware route client — anon key, the caller's JWT from cookies, RLS
 * enforced. Auth GATES live in lib/auth.ts (getUser-validated); this client is
 * for RLS-scoped reads/writes AS the caller.
 */
export const createRouteClient = async () => {
  const cookieStore = await cookies()
  return createSsrServerClient(publicUrl, anonKey, {
    cookies: {
      get(name: string) { return cookieStore.get(name)?.value },
      set() {},
      remove() {},
    },
  })
}

// Server-side clients, lazily constructed. `next build` imports this module
// during static page-data collection, before deploy-time env exists (Railway
// injects env at deploy, not build — see runtime/Dockerfile), so an eager
// createClient() reads an undefined SUPABASE_URL and throws "supabaseUrl is
// required", failing the production build. The Proxy defers construction to
// first use while keeping the `supabaseAdmin.from(...)` call-site API unchanged.
function lazyClient(
  factory: () => SupabaseClient,
): SupabaseClient {
  let c: SupabaseClient | null = null
  return new Proxy({} as SupabaseClient, {
    get(_t, prop) {
      c ??= factory()
      const rec = c as unknown as Record<string | symbol, unknown>
      const value = rec[prop]
      return typeof value === 'function'
        ? (value as (...a: unknown[]) => unknown).bind(c)
        : value
    },
  })
}

// Server-side: service role (bypasses RLS for agent writes).
// Only use behind an auth gate (lib/auth.ts or a Bearer-token getUser check).
export const supabaseAdmin = lazyClient(() =>
  createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  }),
)

// Server-side: anon key (RLS enforced), no session.
export const supabaseAnon = lazyClient(() => createClient(url, anonKey))

export type VatTier = 'trial' | 'essentials' | 'pro' | 'cross_border'

const TIER_MATRIX: Record<string, VatTier[]> = {
  obligation_check:   ['trial', 'essentials', 'pro', 'cross_border'],
  penalty_exposure:   ['trial', 'essentials', 'pro', 'cross_border'],
  partial_exemption:  ['pro', 'cross_border'],
  drc_check:          ['pro', 'cross_border'],
  oss_ioss:           ['cross_border'],
  enquiry_intake:     ['trial', 'essentials', 'pro', 'cross_border'],
}

export function tierAllows(tier: VatTier, feature: string): boolean {
  return (TIER_MATRIX[feature] ?? []).includes(tier)
}
