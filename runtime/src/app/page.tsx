import Link from 'next/link'

const GOLD   = '#D4A843'
const BG     = '#0a0a0a'
const CARD   = '#111111'
const BORDER = '#222222'
const MUTED  = '#888888'
const WHITE  = '#f0f0f0'
const RED    = '#ef4444'

export default function HomePage() {
  return (
    <div
      style={{ backgroundColor: BG, color: WHITE, minHeight: '100vh', fontFamily: 'Satoshi, Inter, sans-serif' }}
      className="flex flex-col"
    >
      {/* Urgency bar */}
      <div
        style={{ backgroundColor: RED, color: '#fff', fontSize: 13, padding: '10px 24px', textAlign: 'center', fontWeight: 600, letterSpacing: '0.01em' }}
      >
        New LPP from April 2025 — 6% if unpaid by day 30, 10% per annum from day 31. Are you exposed?
      </div>

      {/* Header */}
      <header
        style={{ borderBottom: `1px solid ${BORDER}`, padding: '16px 40px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
      >
        <div style={{ fontWeight: 800, fontSize: 20, color: GOLD, letterSpacing: '-0.02em' }}>
          vat.law
        </div>
        <nav style={{ display: 'flex', gap: 24, alignItems: 'center' }}>
          <Link href="/threshold" style={{ color: MUTED, fontSize: 14, textDecoration: 'none' }}>
            Free threshold check
          </Link>
          <Link
            href="/login"
            style={{ color: WHITE, fontSize: 14, fontWeight: 600, padding: '8px 20px', borderRadius: 8, border: `1px solid ${BORDER}`, textDecoration: 'none' }}
          >
            Sign in
          </Link>
          <Link
            href="/login?signup=1"
            style={{ color: '#000', backgroundColor: GOLD, fontSize: 14, fontWeight: 700, padding: '8px 20px', borderRadius: 8, textDecoration: 'none' }}
          >
            Get started
          </Link>
        </nav>
      </header>

      {/* Hero */}
      <main style={{ flex: 1 }}>
        <section style={{ maxWidth: 900, margin: '0 auto', padding: '96px 40px 64px', textAlign: 'center' }}>
          <div
            style={{
              display: 'inline-block',
              padding: '6px 16px',
              borderRadius: 100,
              border: `1px solid ${GOLD}33`,
              backgroundColor: `${GOLD}11`,
              color: GOLD,
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              marginBottom: 32,
            }}
          >
            Complex VAT navigator · MTD-ready · Penalty-point regime aware
          </div>

          <h1
            style={{
              fontSize: 'clamp(36px, 5vw, 60px)',
              fontWeight: 900,
              lineHeight: 1.08,
              color: WHITE,
              marginBottom: 24,
              letterSpacing: '-0.03em',
            }}
          >
            VAT done right.
            <br />
            <span style={{ color: GOLD }}>Not just filed. Done right.</span>
          </h1>

          <p
            style={{
              fontSize: 20,
              color: MUTED,
              lineHeight: 1.6,
              maxWidth: 640,
              margin: '0 auto 40px',
            }}
          >
            Xero files your 9-box return. It doesn&apos;t tell you about your partial exemption
            exposure, DRC obligations, or penalty point position. We do.{' '}
            <span style={{ color: WHITE, fontWeight: 600 }}>£19/mo.</span>
          </p>

          <div style={{ display: 'flex', gap: 16, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 72 }}>
            <Link
              href="/login?signup=1"
              style={{
                backgroundColor: GOLD,
                color: '#000',
                fontWeight: 700,
                fontSize: 15,
                padding: '14px 32px',
                borderRadius: 10,
                textDecoration: 'none',
                letterSpacing: '-0.01em',
              }}
            >
              Start free trial &rarr;
            </Link>
            <Link
              href="/threshold"
              style={{
                backgroundColor: 'transparent',
                color: WHITE,
                fontWeight: 600,
                fontSize: 15,
                padding: '14px 32px',
                borderRadius: 10,
                border: `1px solid ${BORDER}`,
                textDecoration: 'none',
              }}
            >
              Free £90k threshold check
            </Link>
          </div>

          {/* Features grid */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
              gap: 16,
              textAlign: 'left',
              marginBottom: 64,
            }}
          >
            {[
              {
                title: 'Obligation check + threshold watch',
                body: 'Know the moment you cross £90k. Registration required? We tell you before HMRC does. All tiers.',
                tier: 'All tiers',
              },
              {
                title: 'Penalty point tracker',
                body: 'Quarterly filers hit 4 points — £200 fixed penalty. Monthly = 5, annual = 2. We count every point.',
                tier: 'All tiers',
              },
              {
                title: 'Partial exemption calculator',
                body: 'Standard method, de minimis test, annual adjustment flag. Every field VAT Notice 706 demands.',
                tier: 'Pro + Cross-Border',
              },
              {
                title: 'DRC checker',
                body: 'Is your construction invoice subject to domestic reverse charge? CIS-registered? We classify it.',
                tier: 'Pro + Cross-Border',
              },
              {
                title: 'OSS / IOSS',
                body: 'Selling to EU consumers? One-Stop-Shop and Import One-Stop-Shop draft returns, per-country breakdown.',
                tier: 'Cross-Border only',
              },
              {
                title: 'HMRC enquiry response',
                body: 'Notice in the post? India QA + CTA/CIOT partner assigned within 4 hours. £495 one-off. All tiers.',
                tier: 'All tiers · £495',
              },
            ].map((f) => (
              <div
                key={f.title}
                style={{
                  backgroundColor: CARD,
                  border: `1px solid ${BORDER}`,
                  borderRadius: 12,
                  padding: 24,
                }}
              >
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    color: GOLD,
                    marginBottom: 8,
                  }}
                >
                  {f.tier}
                </div>
                <h3 style={{ fontSize: 15, fontWeight: 700, color: WHITE, marginBottom: 8, lineHeight: 1.3 }}>
                  {f.title}
                </h3>
                <p style={{ fontSize: 14, color: MUTED, lineHeight: 1.5 }}>{f.body}</p>
              </div>
            ))}
          </div>

          {/* Pricing */}
          <h2 style={{ fontSize: 28, fontWeight: 800, color: WHITE, marginBottom: 24, letterSpacing: '-0.02em' }}>
            Pricing
          </h2>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: 16,
              textAlign: 'left',
              marginBottom: 24,
            }}
          >
            {[
              {
                name: 'Essentials',
                price: '£19/mo',
                features: ['MTD return prep + submission', 'Penalty point tracker', '90/60/30/7-day alerts', 'Obligation + threshold watch'],
                highlight: false,
              },
              {
                name: 'Pro',
                price: '£49/mo',
                features: ['Everything in Essentials', 'Partial exemption calculator', 'DRC checker', 'Margin scheme records', 'India QA on returns'],
                highlight: true,
              },
              {
                name: 'Cross-Border',
                price: '£149/mo',
                features: ['Everything in Pro', 'OSS / IOSS drafts', 'Place-of-supply rulings', 'Postponed VAT accounting', 'HMRC enquiry included (1/yr)'],
                highlight: false,
              },
            ].map((p) => (
              <div
                key={p.name}
                style={{
                  backgroundColor: p.highlight ? `${GOLD}0d` : CARD,
                  border: `${p.highlight ? 2 : 1}px solid ${p.highlight ? GOLD : BORDER}`,
                  borderRadius: 12,
                  padding: 24,
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 700, color: GOLD, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>
                  {p.name}
                </div>
                <div style={{ fontSize: 28, fontWeight: 900, color: WHITE, marginBottom: 16, letterSpacing: '-0.03em' }}>
                  {p.price}
                </div>
                <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                  {p.features.map((feat) => (
                    <li key={feat} style={{ fontSize: 13, color: MUTED, marginBottom: 6, paddingLeft: 16, position: 'relative' }}>
                      <span style={{ position: 'absolute', left: 0, color: GOLD }}>&#x2713;</span>
                      {feat}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          {/* HMRC enquiry one-off */}
          <div
            style={{
              backgroundColor: `${RED}11`,
              border: `1px solid ${RED}44`,
              borderRadius: 12,
              padding: '20px 28px',
              textAlign: 'left',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 16,
            }}
          >
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: WHITE }}>HMRC enquiry response — £495 one-off</div>
              <div style={{ fontSize: 14, color: MUTED, marginTop: 4 }}>
                India QA + CTA/CIOT partner within 4 hours. Full audit trail. Supreme Capital advance financing available on assessed liability.
              </div>
            </div>
            <Link
              href="/enquiry"
              style={{
                backgroundColor: RED,
                color: '#fff',
                fontWeight: 700,
                fontSize: 14,
                padding: '10px 24px',
                borderRadius: 8,
                textDecoration: 'none',
                whiteSpace: 'nowrap',
              }}
            >
              Log enquiry &rarr;
            </Link>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer
        style={{
          borderTop: `1px solid ${BORDER}`,
          padding: '24px 40px',
          textAlign: 'center',
          fontSize: 12,
          color: MUTED,
          lineHeight: 1.6,
        }}
      >
        vat.law is a non-regulated compliance platform. Regulated VAT advice on individual disputes,
        contentious assessments and tribunal matters is provided by our CTA / CIOT / ATT partner firms.
        We never give individual VAT advice inline.
      </footer>
    </div>
  )
}
