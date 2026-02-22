import type { Metadata, Viewport } from 'next'
import { DM_Sans, Playfair_Display, Special_Elite } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import { BRAND_DESCRIPTION, BRAND_TITLE } from '@/lib/brand'
import './globals.css'

const dmSans = DM_Sans({
  subsets: ['latin'],
  variable: '--font-dm-sans',
})

const playfair = Playfair_Display({
  subsets: ['latin'],
  variable: '--font-playfair',
})

const specialElite = Special_Elite({
  weight: '400',
  subsets: ['latin'],
  variable: '--font-special-elite',
})

export const metadata: Metadata = {
  title: BRAND_TITLE,
  description: BRAND_DESCRIPTION,
  icons: {
    icon: '/favicon.png',
    apple: '/apple-icon.png',
  },
}

export const viewport: Viewport = {
  themeColor: '#1a1a2e',
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body
        className={`${dmSans.variable} ${playfair.variable} ${specialElite.variable} font-sans antialiased`}
      >
        <a
          href="#main-content"
          className="sr-only fixed left-3 top-3 z-[200] rounded-md bg-primary px-4 py-3 text-base font-semibold text-primary-foreground focus:not-sr-only"
        >
          Skip to main content
        </a>
        {children}
        <Analytics />
      </body>
    </html>
  )
}
