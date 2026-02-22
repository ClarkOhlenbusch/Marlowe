import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { TranscriptSpeaker } from '@/lib/live-types'

export type TwilioWebhookParams = Record<string, string>

export type ParsedTwilioWebhookBody = {
  bodyParams: TwilioWebhookParams
  isJson: boolean
}

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

function readUnknownAsString(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed || null
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value)
  }

  if (typeof value === 'boolean') {
    return value ? 'true' : 'false'
  }

  return null
}

function normalizeLookupKey(value: string): string {
  return value.replace(/[^a-zA-Z0-9]/g, '').toLowerCase()
}

function collectJsonRecords(value: unknown, depth = 0, seen = new Set<unknown>()): JsonRecord[] {
  if (depth > 4 || !value || typeof value !== 'object') {
    return []
  }

  if (seen.has(value)) {
    return []
  }
  seen.add(value)

  const out: JsonRecord[] = []

  if (Array.isArray(value)) {
    for (const item of value) {
      out.push(...collectJsonRecords(item, depth + 1, seen))
    }
    return out
  }

  const record = asRecord(value)
  if (!record) return out
  out.push(record)

  for (const nested of Object.values(record)) {
    if (nested && typeof nested === 'object') {
      out.push(...collectJsonRecords(nested, depth + 1, seen))
    }
  }

  return out
}

function readValueFromRecord(record: JsonRecord | null, ...keys: string[]): unknown {
  if (!record) return null

  const lookup = new Set(keys.map((key) => normalizeLookupKey(key)))

  for (const [recordKey, value] of Object.entries(record)) {
    if (lookup.has(normalizeLookupKey(recordKey))) {
      return value
    }
  }

  return null
}

function readValueFromRecords(records: JsonRecord[], ...keys: string[]): unknown {
  for (const record of records) {
    const value = readValueFromRecord(record, ...keys)
    if (value !== null && value !== undefined) {
      return value
    }
  }

  return null
}

function parseTwilioJsonBody(rawBody: string): TwilioWebhookParams {
  try {
    const parsed = JSON.parse(rawBody)
    const records = collectJsonRecords(parsed)
    if (records.length === 0) {
      return {}
    }

    const bodyParams: TwilioWebhookParams = {}
    const assignString = (key: string, value: unknown) => {
      const parsedValue = readUnknownAsString(value)
      if (parsedValue) {
        bodyParams[key] = parsedValue
      }
    }

    assignString('CallSid', readValueFromRecords(records, 'CallSid', 'callSid', 'call_sid'))
    assignString('AccountSid', readValueFromRecords(records, 'AccountSid', 'accountSid', 'account_sid'))
    assignString('CallStatus', readValueFromRecords(records, 'CallStatus', 'callStatus', 'call_status', 'status'))
    assignString('Slug', readValueFromRecords(records, 'Slug', 'slug'))
    assignString(
      'TranscriptionEvent',
      readValueFromRecords(records, 'TranscriptionEvent', 'transcriptionEvent', 'transcription_event', 'eventType'),
    )
    assignString('TranscriptionSid', readValueFromRecords(records, 'TranscriptionSid', 'transcriptionSid', 'transcription_sid'))
    assignString('TranscriptionSessionSid', readValueFromRecords(records, 'TranscriptionSessionSid', 'transcriptionSessionSid', 'transcription_session_sid'))
    assignString('TranscriptionSegmentSid', readValueFromRecords(records, 'TranscriptionSegmentSid', 'transcriptionSegmentSid', 'transcription_segment_sid'))
    assignString('SegmentSid', readValueFromRecords(records, 'SegmentSid', 'segmentSid', 'segment_sid'))
    assignString('SequenceId', readValueFromRecords(records, 'SequenceId', 'sequenceId', 'sequence_id', 'resultIndex', 'result_index'))
    assignString('Track', readValueFromRecords(records, 'Track', 'track', 'Channel', 'channel', 'speaker', 'role', 'participantRole', 'participant_role'))
    assignString('IsFinal', readValueFromRecords(records, 'IsFinal', 'isFinal', 'is_final', 'final'))
    assignString('Timestamp', readValueFromRecords(records, 'Timestamp', 'timestamp', 'Time', 'time', 'DateCreated', 'dateCreated', 'date_created'))
    assignString(
      'TranscriptionText',
      readValueFromRecords(
        records,
        'TranscriptionText',
        'transcriptionText',
        'transcription_text',
        'Transcript',
        'transcript',
        'text',
        'SpeechResult',
        'speechResult',
        'UnstableSpeechResult',
        'unstableSpeechResult',
      ),
    )

    const transcriptionDataRaw = readValueFromRecords(records, 'TranscriptionData', 'transcriptionData', 'transcription_data')

    if (typeof transcriptionDataRaw === 'string') {
      const trimmed = transcriptionDataRaw.trim()
      if (trimmed) {
        bodyParams.TranscriptionData = trimmed
      }
    } else if (transcriptionDataRaw && typeof transcriptionDataRaw === 'object') {
      bodyParams.TranscriptionData = JSON.stringify(transcriptionDataRaw)
    }

    return bodyParams
  } catch {
    return {}
  }
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
  const normalized = track.toLowerCase().trim()

  if (normalized === 'caller' || normalized === 'inbound_track') {
    return 'caller'
  }

  if (normalized === 'other' || normalized === 'outbound_track') {
    return 'other'
  }

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
}): string {
  const sequenceKey =
    params.transcriptionSid && params.sequenceId
      ? `${params.transcriptionSid}:${params.sequenceId}:${params.speaker}`
      : null

  const stablePrimaryId = sequenceKey || params.segmentSid || params.sourceHint

  if (stablePrimaryId) {
    return createHash('sha1')
      .update([params.callSid, stablePrimaryId].join('|'))
      .digest('hex')
  }

  const timestampBucket = Math.floor(params.timestamp / 1_500)
  const fallbackPrimaryId = `${timestampBucket}:${params.speaker}`

  return createHash('sha1')
    .update([params.callSid, fallbackPrimaryId].join('|'))
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

export function parseTwilioWebhookBody(rawBody: string, contentType: string | null): ParsedTwilioWebhookBody {
  const normalizedType = contentType?.split(';')[0]?.trim().toLowerCase() ?? ''
  const trimmedBody = rawBody.trim()
  const looksLikeJson = trimmedBody.startsWith('{') || trimmedBody.startsWith('[')
  const isJson = normalizedType === 'application/json' || normalizedType.endsWith('+json') || looksLikeJson

  if (!isJson) {
    return {
      bodyParams: parseTwilioFormBody(rawBody),
      isJson: false,
    }
  }

  return {
    bodyParams: parseTwilioJsonBody(rawBody),
    isJson: true,
  }
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

function computeSha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function getBodyShaFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url)
    const bodySha = parsed.searchParams.get('bodySHA256')?.trim()
    return bodySha || null
  } catch {
    return null
  }
}

function isValidJsonSignatureCandidate(params: {
  authToken: string
  signature: string
  url: string
  rawBody: string
}): boolean {
  const bodySha = getBodyShaFromUrl(params.url)

  if (bodySha) {
    const computedSha = computeSha256Hex(params.rawBody)
    if (!safeEqual(computedSha.toLowerCase(), bodySha.toLowerCase())) {
      return false
    }
  }

  return safeEqual(computeTwilioSignature(params.authToken, params.url, {}), params.signature)
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
  rawBody?: string
  isJsonBody?: boolean
}): boolean {
  const rawBody = typeof params.rawBody === 'string' ? params.rawBody : null

  if (params.isJsonBody && rawBody !== null) {
    return params.urlCandidates.some((candidate) =>
      isValidJsonSignatureCandidate({
        authToken: params.authToken,
        signature: params.signature,
        url: candidate,
        rawBody,
      }),
    )
  }

  return params.urlCandidates.some((candidate) => {
    return safeEqual(computeTwilioSignature(params.authToken, candidate, params.bodyParams), params.signature)
  })
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
