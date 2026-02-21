import { NextRequest, NextResponse } from 'next/server'
import { generateLiveAdvice } from '@/lib/live-coach'
import {
  appendTranscriptChunk,
  getLiveCallSummary,
  getTranscriptChunks,
  setLiveCallAdvice,
  setLiveCallAnalyzing,
  setLiveCallStatus,
  upsertLiveCallSession,
} from '@/lib/live-store'
import { createDefaultAdvice, isTerminalStatus, normalizeSessionStatus } from '@/lib/live-types'
import { getTwilioConfig } from '@/lib/twilio-api'
import {
  buildTwilioUrlCandidates,
  isValidTwilioSignature,
  parseTwilioFormBody,
  parseTwilioWebhookEvent,
  shouldSkipTwilioWebhookValidation,
} from '@/lib/twilio-webhook'

export const runtime = 'nodejs'

const ADVICE_MIN_INTERVAL_MS = 900
const ADVICE_TRANSCRIPT_LIMIT = 40

type AdviceRunState = {
  running: boolean
  pending: boolean
  lastRunAt: number
}

function getAdviceStateStore(): Map<string, AdviceRunState> {
  const globalCache = globalThis as typeof globalThis & {
    __twilioAdviceRunState?: Map<string, AdviceRunState>
  }

  if (!globalCache.__twilioAdviceRunState) {
    globalCache.__twilioAdviceRunState = new Map()
  }

  return globalCache.__twilioAdviceRunState
}

function isValidSlug(slug: string | null): slug is string {
  return !!slug && /^[a-z0-9-]{3,64}$/.test(slug)
}

async function runAdviceForCall(callSid: string, force = false) {
  const store = getAdviceStateStore()
  const current = store.get(callSid) ?? { running: false, pending: false, lastRunAt: 0 }
  store.set(callSid, current)

  if (current.running) {
    current.pending = true
    return
  }

  const now = Date.now()
  if (!force && now - current.lastRunAt < ADVICE_MIN_INTERVAL_MS) {
    return
  }

  current.running = true

  try {
    let shouldRun = true

    while (shouldRun) {
      current.pending = false

      const summary = await getLiveCallSummary(callSid)
      if (!summary) break

      if (
        !force &&
        summary.lastAdviceAt &&
        Date.now() - summary.lastAdviceAt < ADVICE_MIN_INTERVAL_MS &&
        Date.now() - current.lastRunAt < ADVICE_MIN_INTERVAL_MS
      ) {
        break
      }

      const transcript = await getTranscriptChunks(callSid, ADVICE_TRANSCRIPT_LIMIT)
      if (transcript.length === 0) break

      await setLiveCallAnalyzing(callSid, true).catch(() => {})

      try {
        const advice = await generateLiveAdvice({ transcript })
        await setLiveCallAdvice(callSid, advice, null)
      } catch {
        await setLiveCallAdvice(
          callSid,
          createDefaultAdvice(),
          'Live analysis is delayed. Keep verifying through official channels.',
        ).catch(() => {})
      }

      current.lastRunAt = Date.now()
      force = false
      shouldRun = current.pending
    }
  } finally {
    current.running = false
  }
}

export async function POST(request: NextRequest) {
  const twilioConfig = getTwilioConfig()
  const skipValidation = shouldSkipTwilioWebhookValidation()

  if (!twilioConfig && !skipValidation) {
    return NextResponse.json(
      { ok: false, error: 'Twilio server configuration is missing.' },
      { status: 500 },
    )
  }

  const rawBody = await request.text()
  const bodyParams = parseTwilioFormBody(rawBody)

  if (!skipValidation) {
    if (!twilioConfig) {
      return NextResponse.json(
        { ok: false, error: 'Twilio server configuration is missing.' },
        { status: 500 },
      )
    }

    const signature = request.headers.get('x-twilio-signature')

    if (!signature) {
      return NextResponse.json(
        { ok: false, error: 'Missing Twilio signature.' },
        { status: 401 },
      )
    }

    const urlCandidates = buildTwilioUrlCandidates(request.url, request.headers)
    const validSignature = isValidTwilioSignature({
      authToken: twilioConfig.authToken,
      signature,
      urlCandidates,
      bodyParams,
    })

    if (!validSignature) {
      return NextResponse.json(
        { ok: false, error: 'Invalid Twilio signature.' },
        { status: 401 },
      )
    }
  }

  const slugFromQuery = request.nextUrl.searchParams.get('slug')
  const event = parseTwilioWebhookEvent(bodyParams, slugFromQuery)

  if (!event.callSid) {
    return NextResponse.json({ ok: true })
  }

  if (twilioConfig && event.accountSid && event.accountSid !== twilioConfig.accountSid) {
    return NextResponse.json(
      { ok: false, error: 'Twilio account mismatch.' },
      { status: 401 },
    )
  }

  try {
    let slug = isValidSlug(event.slug) ? event.slug : null
    if (!slug) {
      const existing = await getLiveCallSummary(event.callSid)
      slug = existing?.slug ?? null
    }

    if (!slug) {
      return NextResponse.json(
        { ok: false, error: 'Missing case slug for call session.' },
        { status: 400 },
      )
    }

    await upsertLiveCallSession({
      callSid: event.callSid,
      slug,
      status: event.status ?? undefined,
    })

    if (event.status) {
      const status = normalizeSessionStatus(event.status)
      const statusError = status === 'failed' ? `Call status changed to ${event.status}.` : null
      await setLiveCallStatus(event.callSid, status, statusError)
    }

    if (event.transcript) {
      await appendTranscriptChunk({
        callSid: event.callSid,
        sourceEventId: event.transcript.sourceEventId,
        speaker: event.transcript.speaker,
        text: event.transcript.text,
        isFinal: event.transcript.isFinal,
        timestamp: event.transcript.timestamp,
      })

      const normalizedStatus = normalizeSessionStatus(event.status ?? '')
      const callEnded = isTerminalStatus(normalizedStatus)
      await runAdviceForCall(event.callSid, event.transcript.isFinal || callEnded)
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    const message =
      error instanceof Error && error.message
        ? error.message
        : 'Twilio webhook processing failed.'
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500 },
    )
  }
}
