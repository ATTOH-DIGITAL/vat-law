// Dark dashboard — vat.law
// Stats: businesses monitored, open enquiries (RED if any), penalty point positions, partial exemption calcs.
// Red alert banner if any open_enquiries > 0.
// Quick actions: obligation check, DRC check, log enquiry, partial exemption calc.
// NOTE: Data is placeholder until Supabase live-data wiring (Wave B).

const GOLD   = '#D4A843'
const BG     = '#0d0d0d'
const CARD   = '#111111'
const BORDER = '#1e1e1e'
const MUTED  = '#666666'
const WHITE  = '#f0f0f0'
const RED    = '#ef4444'
const GREEN  = '#10b981'
const AMBER  = '#f59e0b'

// Placeholder stats — replace with live Supabase reads in Wave B
const STATS = {
  businesses_monitored: 0,
  open_enquiries: 0,
  penalty_point_positions: 0,
  partial_exemption_calcs: 0,
}

function StatCard({
  label,
  value,
  sub,
  accent = 'neutral',
}: {
  label: string
  value: string | number
  sub?: string
  accent?: 'red' | 'amber' | 'green' | 'gold' | 'neutral'
}) {
  const valueColor =
    accent === 'red'    ? RED    :
    accent === 'amber'  ? AMBER  :
    accent === 'green'  ? GREEN  :
    accent === 'gold'   ? GOLD   :
    WHITE

  return (
    <div
      style={{
        backgroundColor: CARD,
        border: `1px solid ${accent === 'red' ? `${RED}44` : BORDER}`,
        borderRadius: 12,
        padding: '20px 24px',
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: MUTED, marginBottom: 8 }}>
        {label}
      </div>
      <div style={{ fontSize: 32, fontWeight: 900, color: valueColor, letterSpacing: '-0.03em', lineHeight: 1 }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 12, color: MUTED, marginTop: 6, lineHeight: 1.4 }}>{sub}</div>
      )}
    </div>
  )
}

function QuickAction({ label, href, danger }: { label: string; href: string; danger?: boolean }) {
  return (
    <a
      href={href}
      style={{
        display: 'block',
        backgroundColor: danger ? `${RED}11` : CARD,
        border: `1px solid ${danger ? `${RED}44` : BORDER}`,
        borderRadius: 10,
        padding: '14px 18px',
        fontSize: 14,
        fontWeight: 600,
        color: danger ? RED : WHITE,
        textDecoration: 'none',
        transition: 'border-color 0.15s',
        cursor: 'pointer',
      }}
    >
      {label}
    </a>
  )
}

function AlertBanner({ type, message }: { type: 'critical' | 'warning' | 'info'; message: string }) {
  const styles = {
    critical: { bg: `${RED}15`,    border: `${RED}55`,    color: '#fca5a5' },
    warning:  { bg: `${AMBER}15`,  border: `${AMBER}55`,  color: '#fcd34d' },
    info:     { bg: `${GOLD}10`,   border: `${GOLD}44`,   color: GOLD      },
  }
  const s = styles[type]
  return (
    <div
      style={{
        backgroundColor: s.bg,
        border: `1px solid ${s.border}`,
        borderRadius: 10,
        padding: '12px 18px',
        fontSize: 13,
        color: s.color,
        lineHeight: 1.5,
      }}
    >
      {message}
    </div>
  )
}

export default function DashboardPage() {
  const hasOpenEnquiries = STATS.open_enquiries > 0

  return (
    <div style={{ backgroundColor: BG, minHeight: '100vh', padding: '32px 40px', fontFamily: 'Satoshi, Inter, sans-serif' }}>
      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 26, fontWeight: 900, color: WHITE, letterSpacing: '-0.02em', margin: 0 }}>
          Dashboard
        </h1>
        <p style={{ fontSize: 13, color: MUTED, marginTop: 4 }}>
          vat.law · UK complex-VAT navigator · {new Date().toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
        </p>
      </div>

      {/* Red alert banner — open enquiries */}
      {hasOpenEnquiries && (
        <div
          style={{
            backgroundColor: `${RED}18`,
            border: `1px solid ${RED}`,
            borderRadius: 12,
            padding: '16px 24px',
            marginBottom: 28,
            display: 'flex',
            alignItems: 'center',
            gap: 16,
          }}
        >
          <span style={{ fontSize: 20 }}>&#9888;</span>
          <div>
            <span style={{ fontSize: 15, fontWeight: 700, color: RED }}>
              {STATS.open_enquiries} open HMRC {STATS.open_enquiries === 1 ? 'enquiry' : 'enquiries'}
            </span>
            <span style={{ fontSize: 13, color: '#fca5a5', marginLeft: 12 }}>
              Do not respond without India QA + CTA adviser sign-off.
            </span>
          </div>
          <a
            href="/dashboard/enquiries"
            style={{ marginLeft: 'auto', backgroundColor: RED, color: '#fff', fontWeight: 700, fontSize: 13, padding: '8px 18px', borderRadius: 8, textDecoration: 'none' }}
          >
            View enquiries &rarr;
          </a>
        </div>
      )}

      {/* Stats grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: 16,
          marginBottom: 32,
        }}
      >
        <StatCard
          label="Businesses monitored"
          value={STATS.businesses_monitored || '—'}
          sub="VAT obligation + threshold watches active"
          accent="neutral"
        />
        <StatCard
          label="Open HMRC enquiries"
          value={STATS.open_enquiries || '—'}
          sub={hasOpenEnquiries ? 'Immediate action required' : 'No open enquiries'}
          accent={hasOpenEnquiries ? 'red' : 'green'}
        />
        <StatCard
          label="Penalty point positions"
          value={STATS.penalty_point_positions || '—'}
          sub="Quarterly: 4 pts = £200 · Monthly: 5 pts · Annual: 2 pts"
          accent="amber"
        />
        <StatCard
          label="Partial exemption calcs"
          value={STATS.partial_exemption_calcs || '—'}
          sub="Pro + Cross-Border. Annual adjustment flagged separately."
          accent="gold"
        />
      </div>

      {/* Alerts */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 32 }}>
        <AlertBanner
          type="critical"
          message="LPP (April 2025): 3% on day 15 + 3% on day 30 of outstanding VAT. 10% per annum daily from day 31. One missed quarter starts the clock."
        />
        <AlertBanner
          type="warning"
          message="Partial exemption annual adjustment is due in the return covering your longer-period year-end. Divergence beyond ±1% from provisional rate requires recalculation."
        />
        <AlertBanner
          type="info"
          message="HMRC enquiry tier (£495 one-off) routes through a CTA / CIOT / ATT partner firm. Platform never gives regulated VAT dispute advice inline."
        />
      </div>

      {/* Quick actions + integrations */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: 24,
          marginBottom: 32,
        }}
      >
        {/* Quick actions */}
        <div
          style={{
            backgroundColor: CARD,
            border: `1px solid ${BORDER}`,
            borderRadius: 12,
            padding: 24,
          }}
        >
          <h2 style={{ fontSize: 14, fontWeight: 700, color: WHITE, marginBottom: 16, letterSpacing: '-0.01em' }}>
            Quick actions
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <QuickAction label="Obligation check"      href="/dashboard/obligation" />
            <QuickAction label="DRC check"             href="/dashboard/drc" />
            <QuickAction label="Partial exemption calc" href="/dashboard/partial-exemption" />
            <QuickAction label="OSS / IOSS draft"      href="/dashboard/cross-border" />
            <QuickAction label="Log HMRC enquiry"      href="/dashboard/enquiries/new" danger />
            <QuickAction label="Penalty point tracker" href="/dashboard/returns" />
          </div>
        </div>

        {/* Integrations */}
        <div
          style={{
            backgroundColor: CARD,
            border: `1px solid ${BORDER}`,
            borderRadius: 12,
            padding: 24,
          }}
        >
          <h2 style={{ fontSize: 14, fontWeight: 700, color: WHITE, marginBottom: 16, letterSpacing: '-0.01em' }}>
            Integrations
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[
              { name: 'HMRC MTD VAT',      status: 'Not connected' },
              { name: 'Xero',              status: 'Not connected' },
              { name: 'QuickBooks Online', status: 'Not connected' },
              { name: 'Sage Business Cloud', status: 'Not connected' },
              { name: 'FreeAgent',         status: 'Not connected' },
            ].map((int) => (
              <div key={int.name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 13, color: WHITE }}>{int.name}</span>
                <span
                  style={{
                    fontSize: 12,
                    color: int.status === 'Connected' ? GREEN : MUTED,
                    backgroundColor: int.status === 'Connected' ? `${GREEN}18` : `${MUTED}18`,
                    padding: '3px 10px',
                    borderRadius: 100,
                    fontWeight: 600,
                  }}
                >
                  {int.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Footer note */}
      <p style={{ fontSize: 11, color: MUTED, textAlign: 'center', lineHeight: 1.6 }}>
        vat.law is a non-regulated compliance platform. Regulated VAT advice is provided by our CTA / CIOT / ATT partner network.
        Never respond to HMRC correspondence without adviser sign-off.
      </p>
    </div>
  )
}
