import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'vat.law — Complex UK VAT, navigated by AI',
  description: 'Partial exemption, reverse charge, OSS/IOSS, capital goods, TOMS and HMRC enquiry response — on autopilot. Regulated advice via our CTA / CIOT partner. From £19/month.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body
        className={inter.className}
        style={{
          '--brand': '#4338ca',
          '--brand-dark': '#312e81',
          '--brand-light': '#eef2ff',
          '--brand-border': '#a5b4fc',
        } as React.CSSProperties}
      >
        {children}
      </body>
    </html>
  )
}
