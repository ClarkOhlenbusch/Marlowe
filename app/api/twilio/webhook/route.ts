import { NextRequest, NextResponse } from 'next/server'
import { ModelAdviceError, generateHeuristicAdvice, generateModelAdvice } from '@/lib/live-coach'
import {
  appendTranscriptChunk,
  getLiveCallSummary,
  getTranscriptChunks,
  setLiveCallAdvice,
  setLiveCallAnalyzing,
  setLiveCallStatus,
  upsertLiveCallSession,
} from '@/lib/live-store'
import { isTerminalStatus, normalizeSessionStatus } from '@/lib/live-types'
import { getTwilioConfig } from '@/lib/twilio-api'
import {
  buildTwilioUrlCandidates,
  isValidTwilioSignature,
  parseTwilioFormBody,
  parseTwilioWebhookEvent,
  shouldSkipTwilioWebhookValidation,
} from '@/lib/twilio-webhook'

export const runtime = 'nodejs'

const DEFAULT_GROQ_RPM_LIMIT = 30
const DEFAULT_MODEL_MIN_INTERVAL_MS = 2_800
const MODEL_INTERVAL_BUFFER_MS = 400
const RATE_LIMIT_BASE_BACKOFF_MS = 6_000
const RATE_LIMIT_MAX_BACKOFF_MS = 60_000
const RATE_LIMIT_STREAK_RESET_MS = 90_000
const ADVICE_TRANSCRIPT_LIMIT = 40
const ADVICE_DELAYED_MESSAGE =
  'Live analysis is delayed. Keep verifying through official channels.'
const ADVICE_RATE_LIMITED_MESSAGE =
  'Live analysis is temporarily rate-limited. Using local scoring for now.'
const HAS_GROQ_MODEL = Boolean(process.env.GROQ_API_KEY?.trim())
const MODEL_MIN_INTERVAL_MS = getModelMinIntervalMs()

type AdviceRunState = {
  running: boolean
  pending: boolean
  forceModel: boolean
  lastModelRunAt: number
  modelCooldownUntil: number
  rateLimitStreak: number
  lastRateLimitAt: number
  terminal: boolean
}

function parsePositiveInt(value: string | undefined): number | null {
  if (!value?.trim()) {
    return null
  }

  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null
  }

  return parsed
}

function getModelMinIntervalMs(): number {
  const explicitIntervalMs = parsePositiveInt(process.env.GROQ_MIN_INTERVAL_MS)
  if (explicitIntervalMs) {
    return explicitIntervalMs
  }

  const rpmLimit = parsePositiveInt(process.env.GROQ_RPM_LIMIT) ?? DEFAULT_GROQ_RPM_LIMIT
  const intervalFromRpm = Math.ceil(60_000 / rpmLimit) + MODEL_INTERVAL_BUFFER_MS
  return Math.max(DEFAULT_MODEL_MIN_INTERVAL_MS, intervalFromRpm)
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

function runAdviceForCall(callSid: string, force = false) {
  const store = getAdviceStateStore()
  const current = store.get(callSid) ?? {
    running: false,
    pending: false,
    forceModel: false,
    lastModelRunAt: 0,
    modelCooldownUntil: 0,
    rateLimitStreak: 0,
    lastRateLimitAt: 0,
    terminal: false,
  }
  store.set(callSid, current)

  current.pending = true
  current.forceModel = current.forceModel || force

  if (current.running) {
    return
  }

  void processAdviceQueue(callSid)
}

function getRateLimitBackoffMs(error: unknown, state: AdviceRunState): number {
  if (!(error instanceof ModelAdviceError) || error.statusCode !== 429) {
    state.rateLimitStreak = 0
    state.lastRateLimitAt = 0
    return 0
  }

  const now = Date.now()
  if (now - state.lastRateLimitAt > RATE_LIMIT_STREAK_RESET_MS) {
    state.rateLimitStreak = 0
  }

  state.rateLimitStreak += 1
  state.lastRateLimitAt = now

  const exponentialBackoffMs = Math.min(
    RATE_LIMIT_MAX_BACKOFF_MS,
    RATE_LIMIT_BASE_BACKOFF_MS * 2 ** (state.rateLimitStreak - 1),
  )
  const retryAfterMs = error.retryAfterMs ?? 0

  return Math.max(exponentialBackoffMs, retryAfterMs)
}

async function processAdviceQueue(callSid: string) {
  const store = getAdviceStateStore()
  const current = store.get(callSid)

  if (!current || current.running) {
    return
  }

  current.running = true

  try {
    while (current.pending) {
      current.pending = false
      const forceModel = current.forceModel
      current.forceModel = false
      try {
        await runAdviceCycle(callSid, current, forceModel)
      } catch {
        await setLiveCallAnalyzing(callSid, false).catch(() => {})
      }
    }
  } finally {
    current.running = false

    if (!current.pending && current.terminal) {
      store.delete(callSid)
      return
    }

    if (current.pending) {
      void processAdviceQueue(callSid)
    }
  }
}

async function runAdviceCycle(callSid: string, state: AdviceRunState, forceModel: boolean) {
  const summary = await getLiveCallSummary(callSid)

  if (!summary) {
    state.terminal = true
    return
  }

  const normalizedStatus = normalizeSessionStatus(summary.status)
  const callEnded = isTerminalStatus(normalizedStatus)
  state.terminal = callEnded

  const transcript = await getTranscriptChunks(callSid, ADVICE_TRANSCRIPT_LIMIT)
  if (transcript.length === 0) {
    return
  }

  const heuristicAdvice = generateHeuristicAdvice({ transcript })
  await setLiveCallAdvice(callSid, heuristicAdvice, {
    lastError: null,
    analyzing: false,
  }).catch(() => {})

  const now = Date.now()
  const shouldRunModel =
    HAS_GROQ_MODEL &&
    now >= state.modelCooldownUntil &&
    (forceModel || callEnded || now - state.lastModelRunAt >= MODEL_MIN_INTERVAL_MS)

  if (!shouldRunModel) {
    return
  }

  await setLiveCallAnalyzing(callSid, true).catch(() => {})

  try {
    const modelAdvice = await generateModelAdvice({ transcript })

    if (!modelAdvice) {
      state.lastModelRunAt = Date.now()
      await setLiveCallAnalyzing(callSid, false).catch(() => {})
      return
    }

    await setLiveCallAdvice(callSid, modelAdvice, {
      lastError: null,
      analyzing: false,
    })
    state.lastModelRunAt = Date.now()
    state.modelCooldownUntil = 0
    state.rateLimitStreak = 0
    state.lastRateLimitAt = 0
  } catch (error) {
    const failedAt = Date.now()
    state.lastModelRunAt = failedAt
    const backoffMs = getRateLimitBackoffMs(error, state)

    if (backoffMs > 0) {
      state.modelCooldownUntil = failedAt + backoffMs
    }

    await setLiveCallAdvice(callSid, heuristicAdvice, {
      lastError: backoffMs > 0 ? ADVICE_RATE_LIMITED_MESSAGE : ADVICE_DELAYED_MESSAGE,
      analyzing: false,
    }).catch(() => {})
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
      runAdviceForCall(event.callSid, event.transcript.isFinal || callEnded)
    } else if (event.status && isTerminalStatus(normalizeSessionStatus(event.status))) {
      runAdviceForCall(event.callSid, true)
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
