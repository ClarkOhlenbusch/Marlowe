import { NextRequest, NextResponse } from 'next/server'
import { getPublicBaseUrl } from '@/lib/public-url'

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

type TranscriptionAttrs = Record<string, string>

function serializeXmlAttrs(attrs: TranscriptionAttrs): string {
  return Object.entries(attrs)
    .map(([key, value]) => `${key}="${escapeXml(value)}"`)
    .join(' ')
}

function buildBaselineTranscriptionAttrs(webhookUrl: string): TranscriptionAttrs {
  return {
    statusCallbackUrl: webhookUrl,
    track: 'both_tracks',
    partialResults: 'true',
  }
}

function buildDeepgramNova3TranscriptionAttrs(webhookUrl: string): TranscriptionAttrs {
  return {
    ...buildBaselineTranscriptionAttrs(webhookUrl),
    transcriptionEngine: 'deepgram',
    speechModel: 'nova-3',
    languageCode: 'en-US',
    inboundTrackLabel: 'caller',
    outboundTrackLabel: 'other',
    enableProviderData: 'true',
  }
}

function isValidTranscriptionAttrs(attrs: TranscriptionAttrs): boolean {
  const requiredKeys = ['statusCallbackUrl', 'track', 'partialResults'] as const
  const hasRequired = requiredKeys.every((key) => {
    const value = attrs[key]
    return typeof value === 'string' && value.trim().length > 0
  })

  if (!hasRequired) return false
  return Object.values(attrs).every((value) => typeof value === 'string' && value.trim().length > 0)
}

function buildTranscriptionXml(webhookUrl: string): string {
  const deepgramAttrs = buildDeepgramNova3TranscriptionAttrs(webhookUrl)

  if (isValidTranscriptionAttrs(deepgramAttrs)) {
    return `<Transcription ${serializeXmlAttrs(deepgramAttrs)} />`
  }

  const baselineAttrs = buildBaselineTranscriptionAttrs(webhookUrl)
  return `<Transcription ${serializeXmlAttrs(baselineAttrs)} />`
}

function buildTwiml(request: NextRequest): string {
  const slug = request.nextUrl.searchParams.get('slug')
  const publicBaseUrl = getPublicBaseUrl(request)

  const webhookUrl = new URL('/api/twilio/webhook', publicBaseUrl)
  const redirectUrl = new URL('/api/twilio/twiml', publicBaseUrl)

  if (isValidSlug(slug)) {
    webhookUrl.searchParams.set('slug', slug)
    redirectUrl.searchParams.set('slug', slug)
  }

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Response>',
    `  <Start>${buildTranscriptionXml(webhookUrl.toString())}</Start>`,
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
