import Link from 'next/link'

const nav = [
  { label: 'Dashboard', href: '/dashboard' },
  { label: 'Returns', href: '/dashboard/returns' },
  { label: 'Partial Exemption', href: '/dashboard/partial-exemption' },
  { label: 'DRC', href: '/dashboard/drc' },
  { label: 'Margin Schemes', href: '/dashboard/margin' },
  { label: 'Cross-Border (OSS/IOSS)', href: '/dashboard/cross-border' },
  { label: 'Capital Goods', href: '/dashboard/cgs' },
  { label: 'HMRC Enquiries', href: '/dashboard/enquiries' },
  { label: 'trained QA reviewer', href: '/dashboard/qa' },
  { label: 'Settings', href: '/dashboard/settings' },
]

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex">
      <aside className="w-60 shrink-0 border-r border-gray-100 flex flex-col">
        <div className="px-5 py-5 font-bold text-lg border-b border-gray-100" style={{ color: 'var(--brand)' }}>
          vat.law
        </div>
        <nav className="flex-1 py-4">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="block px-5 py-2.5 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-50"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="px-5 py-4 border-t border-gray-100 text-xs text-gray-400 leading-relaxed">
          Platform: non-regulated · HMRC enquiry advice: CTA / CIOT partner firm
        </div>
        <div className="px-5 py-3 border-t border-gray-100">
          <form method="post" action="/api/auth/logout"><button type="submit" className="text-xs text-gray-400 hover:text-gray-600" style={{background:'none',border:0,padding:0,cursor:'pointer'}}>Sign out</button></form>
        </div>
      </aside>
      <main className="flex-1 overflow-auto bg-gray-50">
        {children}
      </main>
    </div>
  )
}
