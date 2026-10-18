'use client'

import { useState } from 'react'
import Link from 'next/link'
import { createBrowserClient } from '@/lib/supabase-browser'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const supabase = createBrowserClient()
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${location.origin}/api/auth/callback?next=/dashboard` },
    })
    setLoading(false)
    if (error) setError(error.message)
    else setSent(true)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm bg-white border border-gray-200 rounded-xl p-8 shadow-sm">
        <Link href="/" className="block font-bold text-xl mb-2" style={{ color: 'var(--brand)' }}>vat.law</Link>
        <p className="text-sm text-gray-500 mb-6">Sign in or create your account with a one-time email link.</p>

        {sent ? (
          <div className="rounded-lg border px-4 py-3 text-sm" style={{ backgroundColor: 'var(--brand-light)', borderColor: 'var(--brand-border)', color: 'var(--brand-dark)' }}>
            Check your inbox — we&apos;ve sent a sign-in link to <strong>{email}</strong>.
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <label className="block">
              <span className="text-xs font-semibold text-gray-700">Work email</span>
              <input
                type="email"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@yourbusiness.co.uk"
                className="mt-1 w-full px-3 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-offset-0"
                style={{ '--tw-ring-color': 'var(--brand)' } as React.CSSProperties}
              />
            </label>
            {error && <p className="text-xs text-red-600">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 rounded-lg text-white font-semibold text-sm disabled:opacity-50"
              style={{ backgroundColor: 'var(--brand)' }}
            >
              {loading ? 'Sending link…' : 'Email me a sign-in link'}
            </button>
          </form>
        )}

        <p className="text-xs text-gray-400 mt-6 text-center">
          By signing in you agree to vat.law&apos;s terms. Regulated VAT advice on disputes is provided by our CTA / CIOT partner firms.
        </p>
      </div>
    </div>
  )
}
