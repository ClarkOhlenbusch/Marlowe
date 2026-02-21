import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { TranscriptSpeaker } from '@/lib/live-types'

export type TwilioWebhookParams = Record<string, string>

export type ParsedTwilioWebhookEvent = {
  callSid: string | null
  accountSid: string | null
  slug: string | null
  status: string | null
  transcript: {
    text: string
    speaker: TranscriptSpeaker
    isFinal: boolean
    timestamp: number
    sourceEventId: string
  } | null
}

type JsonRecord = Record<string, unknown>

function readString(params: TwilioWebhookParams, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = params[key]
    if (typeof value === 'string') {
      const trimmed = value.trim()
      if (trimmed) return trimmed
    }
  }
  return null
}

function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as JsonRecord
}

function readStringFromRecord(record: JsonRecord | null, ...keys: string[]): string | null {
  if (!record) return null
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string') {
      const trimmed = value.trim()
      if (trimmed) return trimmed
    }
  }
  return null
}

function readBoolean(value: string | null): boolean | null {
  if (!value) return null
  const normalized = value.toLowerCase()
  if (['1', 'true', 'yes', 'y'].includes(normalized)) return true
  if (['0', 'false', 'no', 'n'].includes(normalized)) return false
  return null
}

function parseTimestamp(value: string | null): number {
  if (!value) return Date.now()

  const asNumber = Number(value)
  if (Number.isFinite(asNumber)) {
    if (asNumber > 1_000_000_000_000) return Math.round(asNumber)
    if (asNumber > 1_000_000_000) return Math.round(asNumber * 1000)
  }

  const asDate = Date.parse(value)
  if (Number.isFinite(asDate)) {
    return asDate
  }

  return Date.now()
}

function parseSpeaker(track: string | null): TranscriptSpeaker {
  if (!track) return 'unknown'
  const normalized = track.toLowerCase()

  if (
    normalized.includes('caller') ||
    normalized.includes('customer') ||
    normalized.includes('inbound')
  ) {
    return 'caller'
  }

  if (
    normalized.includes('outbound') ||
    normalized.includes('callee') ||
    normalized.includes('agent') ||
    normalized.includes('recipient') ||
    normalized.includes('other')
  ) {
    return 'other'
  }

  return 'unknown'
}

function parseTranscriptionData(
  rawData: string | null,
): {
  text: string | null
  isFinal: boolean | null
  speakerHint: string | null
  timestampHint: string | null
  sourceHint: string | null
} {
  if (!rawData) {
    return {
      text: null,
      isFinal: null,
      speakerHint: null,
      timestampHint: null,
      sourceHint: null,
    }
  }

  try {
    const parsed = JSON.parse(rawData)
    const record = asRecord(parsed)

    const segment = Array.isArray(record?.segments) ? asRecord(record?.segments[0]) : null

    const text =
      readStringFromRecord(record, 'transcript', 'text') ||
      readStringFromRecord(segment, 'transcript', 'text')

    const finalRaw =
      readStringFromRecord(record, 'isFinal', 'final') ||
      readStringFromRecord(segment, 'isFinal', 'final')
    const isFinal = readBoolean(finalRaw)

    const speakerHint =
      readStringFromRecord(record, 'track', 'channel', 'speaker', 'role') ||
      readStringFromRecord(segment, 'track', 'channel', 'speaker', 'role')

    const timestampHint =
      readStringFromRecord(record, 'timestamp', 'time', 'createdAt') ||
      readStringFromRecord(segment, 'timestamp', 'time', 'createdAt')

    const sourceHint =
      readStringFromRecord(record, 'id', 'segmentId', 'sequence') ||
      readStringFromRecord(segment, 'id', 'segmentId', 'sequence')

    return {
      text,
      isFinal,
      speakerHint,
      timestampHint,
      sourceHint,
    }
  } catch {
    return {
      text: null,
      isFinal: null,
      speakerHint: null,
      timestampHint: null,
      sourceHint: null,
    }
  }
}

function buildSourceEventId(params: {
  callSid: string
  transcriptionSid: string | null
  sequenceId: string | null
  segmentSid: string | null
  sourceHint: string | null
  timestamp: number
  speaker: TranscriptSpeaker
  text: string
}): string {
  const primaryId =
    params.segmentSid ||
    params.sourceHint ||
    [params.transcriptionSid, params.sequenceId].filter(Boolean).join(':') ||
    `${params.timestamp}:${params.speaker}`

  return createHash('sha1')
    .update(
      [
        params.callSid,
        primaryId,
        params.text.trim().toLowerCase(),
      ].join('|'),
    )
    .digest('hex')
}

export function parseTwilioFormBody(rawBody: string): TwilioWebhookParams {
  const search = new URLSearchParams(rawBody)
  const parsed: TwilioWebhookParams = {}

  for (const [key, value] of search.entries()) {
    parsed[key] = value
  }

  return parsed
}

function computeTwilioSignature(
  authToken: string,
  url: string,
  params: TwilioWebhookParams,
): string {
  const sortedKeys = Object.keys(params).sort()
  const payload = sortedKeys.reduce((acc, key) => `${acc}${key}${params[key]}`, url)

  return createHmac('sha1', authToken).update(payload).digest('base64')
}

function safeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a)
  const bBuf = Buffer.from(b)

  if (aBuf.length !== bBuf.length) return false
  return timingSafeEqual(aBuf, bBuf)
}

export function shouldSkipTwilioWebhookValidation(): boolean {
  return process.env.TWILIO_WEBHOOK_SKIP_SIGNATURE_VALIDATION === '1' || process.env.NODE_ENV === 'test'
}

export function buildTwilioUrlCandidates(requestUrl: string, headers: Headers): string[] {
  const unique = new Set<string>()

  try {
    unique.add(new URL(requestUrl).toString())
  } catch {
    // Ignore malformed URL, request handler will fail validation anyway.
  }

  try {
    const parsed = new URL(requestUrl)
    const forwardedHost = headers.get('x-forwarded-host') || headers.get('host')
    const forwardedProto = headers.get('x-forwarded-proto')

    if (forwardedHost) {
      parsed.host = forwardedHost
    }

    if (forwardedProto) {
      parsed.protocol = `${forwardedProto.replace(':', '')}:`
    }

    unique.add(parsed.toString())
  } catch {
    // Ignore malformed URL variants.
  }

  return Array.from(unique)
}

export function isValidTwilioSignature(params: {
  authToken: string
  signature: string
  urlCandidates: string[]
  bodyParams: TwilioWebhookParams
}): boolean {
  return params.urlCandidates.some((candidate) =>
    safeEqual(computeTwilioSignature(params.authToken, candidate, params.bodyParams), params.signature),
  )
}

export function parseTwilioWebhookEvent(
  bodyParams: TwilioWebhookParams,
  slugFromQuery: string | null,
): ParsedTwilioWebhookEvent {
  const callSid = readString(bodyParams, 'CallSid')
  const accountSid = readString(bodyParams, 'AccountSid')
  const status = readString(bodyParams, 'CallStatus')
  const slug = slugFromQuery ?? readString(bodyParams, 'slug', 'Slug')

  const transcriptionData = parseTranscriptionData(readString(bodyParams, 'TranscriptionData'))

  const transcriptText =
    readString(bodyParams, 'TranscriptionText', 'Transcript', 'SpeechResult', 'UnstableSpeechResult') ||
    transcriptionData.text

  if (!callSid || !transcriptText) {
    return {
      callSid,
      accountSid,
      slug,
      status,
      transcript: null,
    }
  }

  const eventName = readString(bodyParams, 'TranscriptionEvent', 'EventType', 'SpeechEventType')
  const explicitFinal = readBoolean(readString(bodyParams, 'IsFinal', 'Final'))

  const isFinal =
    explicitFinal ??
    transcriptionData.isFinal ??
    Boolean(eventName && /(final|complete|stopped)/i.test(eventName))

  const speakerHint =
    readString(bodyParams, 'Track', 'track', 'Channel', 'ChannelName', 'ParticipantRole', 'ParticipantLabel') ||
    transcriptionData.speakerHint

  const speaker = parseSpeaker(speakerHint)

  const timestamp = parseTimestamp(
    readString(
      bodyParams,
      'Timestamp',
      'Time',
      'SequenceStartTime',
      'TranscriptionTimestamp',
      'DateCreated',
    ) || transcriptionData.timestampHint,
  )

  const sourceEventId = buildSourceEventId({
    callSid,
    transcriptionSid: readString(bodyParams, 'TranscriptionSid', 'TranscriptionSessionSid'),
    sequenceId: readString(bodyParams, 'SequenceId', 'ResultIndex', 'SegmentIndex'),
    segmentSid: readString(bodyParams, 'TranscriptionSegmentSid', 'SegmentSid'),
    sourceHint: transcriptionData.sourceHint,
    timestamp,
    speaker,
    text: transcriptText,
  })

  return {
    callSid,
    accountSid,
    slug,
    status,
    transcript: {
      text: transcriptText,
      speaker,
      isFinal,
      timestamp,
      sourceEventId,
    },
  }
}
