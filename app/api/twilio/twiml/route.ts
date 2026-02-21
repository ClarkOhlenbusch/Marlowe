import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

function isValidSlug(value: string | null): value is string {
  return !!value && /^[a-z0-9-]{3,64}$/.test(value)
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

function buildTwiml(request: NextRequest): string {
  const slug = request.nextUrl.searchParams.get('slug')

  const webhookUrl = new URL('/api/twilio/webhook', request.url)
  const redirectUrl = new URL('/api/twilio/twiml', request.url)

  if (isValidSlug(slug)) {
    webhookUrl.searchParams.set('slug', slug)
    redirectUrl.searchParams.set('slug', slug)
  }

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Response>',
    `  <Start><Transcription statusCallbackUrl="${escapeXml(webhookUrl.toString())}" track="both_tracks" /></Start>`,
    '  <Pause length="60"/>',
    `  <Redirect method="POST">${escapeXml(redirectUrl.toString())}</Redirect>`,
    '</Response>',
  ].join('\n')
}

function asXmlResponse(xml: string): NextResponse {
  return new NextResponse(xml, {
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}

export async function GET(request: NextRequest) {
  return asXmlResponse(buildTwiml(request))
}

export async function POST(request: NextRequest) {
  return asXmlResponse(buildTwiml(request))
}
