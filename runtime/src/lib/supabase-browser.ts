'use client'

import { createBrowserClient as createSsrBrowserClient } from '@supabase/ssr'

// Browser-side client (RLS enforced via anon key). Lives in its own module so
// client components never import lib/supabase.ts, which builds the
// service-role admin client server-side.
export const createBrowserClient = () =>
  createSsrBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )
