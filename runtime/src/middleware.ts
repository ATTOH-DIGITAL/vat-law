import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Middleware only handles PAGE redirects (/dashboard gate + /login bounce).
// API routes are NOT gated here — each API route carries its own validated
// gate in-route (lib/auth.ts getAuthedUser / Bearer-token getUser). The old
// PUBLIC_PATHS list was dead code: it was computed but never enforced.

export async function middleware(req: NextRequest) {
  // Current official @supabase/ssr middleware shape (getAll/setAll): refresh
  // cookies are batched, so the response is recreated ONCE per batch — the
  // per-cookie set/remove variant drops earlier Set-Cookie headers when the
  // auth token is chunked (sb-*-auth-token.0/.1).
  let res = NextResponse.next({ request: req })
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return req.cookies.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => req.cookies.set(name, value))
          res = NextResponse.next({ request: req })
          cookiesToSet.forEach(({ name, value, options }) => res.cookies.set(name, value, options))
        },
      },
    },
  )

  // getUser() validates the JWT against Supabase — stronger than trusting the
  // session cookie shape (getSession) for a route gate.
  const { data: { user } } = await supabase.auth.getUser()
  const path = req.nextUrl.pathname

  if (path.startsWith('/dashboard') && !user) {
    const url = req.nextUrl.clone()
    url.pathname = '/login'
    url.searchParams.set('next', path)
    const redirect = NextResponse.redirect(url)
    res.cookies.getAll().forEach((c) => redirect.cookies.set(c))
    return redirect
  }
  if (path === '/login' && user) {
    const url = req.nextUrl.clone()
    url.pathname = '/dashboard'
    const redirect = NextResponse.redirect(url)
    res.cookies.getAll().forEach((c) => redirect.cookies.set(c))
    return redirect
  }
  return res
}

export const config = {
  matcher: ['/dashboard/:path*', '/login'],
}
