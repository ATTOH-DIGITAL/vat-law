import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export const runtime = 'nodejs'

// POST, not GET: Next <Link> production prefetch fires GETs for in-viewport
// links — a GET signout would log users out on render (review finding).
export async function POST(request: NextRequest) {
  const { origin } = new URL(request.url)
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        // getAll/setAll (not get/set/remove): the legacy adapter caps signOut
        // cookie-clearing at 5 chunks per key. Mirrors middleware so chunked
        // auth tokens are fully cleared on logout.
        getAll() { return cookieStore.getAll() },
        setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set({ name, value, ...options }))
        },
      },
    },
  )
  await supabase.auth.signOut()
  return NextResponse.redirect(`${origin}/login`, { status: 303 })
}
