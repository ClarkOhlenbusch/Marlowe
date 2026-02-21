import { createAdminClient } from '@/lib/supabase/admin'
import {
  CoachingAdvice,
  LiveSessionSnapshot,
  TranscriptChunk,
  TranscriptSpeaker,
  createDefaultAdvice,
  getRiskLevel,
  normalizeSessionStatus,
} from '@/lib/live-types'

type LiveCallRow = {
  call_sid: string
  slug: string
  status: string
  assistant_muted: boolean
  analyzing: boolean
  last_error: string | null
  advice: unknown
  updated_at: string
  last_advice_at: string | null
}

type TranscriptRow = {
  id: number
  speaker: string
  text: string
  timestamp_ms: number
  is_final: boolean
}

function toSpeaker(value: string): TranscriptSpeaker {
  const normalized = value.toLowerCase()
  if (normalized === 'caller') return 'caller'
  if (normalized === 'other') return 'other'
  return 'unknown'
}

function normalizeSpeaker(value: TranscriptSpeaker): 'caller' | 'other' | 'unknown' {
  if (value === 'caller') return 'caller'
  if (value === 'other') return 'other'
  return 'unknown'
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function toAdvice(payload: unknown): CoachingAdvice {
  const fallback = createDefaultAdvice()

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return fallback
  }

  const data = payload as Record<string, unknown>
  const riskScoreRaw = typeof data.riskScore === 'number' ? data.riskScore : fallback.riskScore
  const riskScore = clamp(Math.round(riskScoreRaw), 0, 100)

  const nextSteps = Array.isArray(data.nextSteps)
    ? data.nextSteps.filter((step): step is string => typeof step === 'string' && step.trim().length > 0).slice(0, 3)
    : fallback.nextSteps

  const riskLevel =
    typeof data.riskLevel === 'string' && ['low', 'medium', 'high'].includes(data.riskLevel)
      ? (data.riskLevel as 'low' | 'medium' | 'high')
      : getRiskLevel(riskScore)

  return {
    riskScore,
    riskLevel,
    feedback: typeof data.feedback === 'string' && data.feedback.trim() ? data.feedback : fallback.feedback,
    whatToSay:
      typeof data.whatToSay === 'string' && data.whatToSay.trim() ? data.whatToSay : fallback.whatToSay,
    whatToDo: typeof data.whatToDo === 'string' && data.whatToDo.trim() ? data.whatToDo : fallback.whatToDo,
    nextSteps,
    confidence:
      typeof data.confidence === 'number' ? clamp(data.confidence, 0, 1) : fallback.confidence,
    updatedAt:
      typeof data.updatedAt === 'number' && Number.isFinite(data.updatedAt)
        ? Math.round(data.updatedAt)
        : Date.now(),
  }
}

function parseTimestampMs(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value > 1_000_000_000_000) return Math.round(value)
    if (value > 1_000_000_000) return Math.round(value * 1000)
  }

  if (typeof value === 'string') {
    const asNumber = Number(value)
    if (Number.isFinite(asNumber)) {
      if (asNumber > 1_000_000_000_000) return Math.round(asNumber)
      if (asNumber > 1_000_000_000) return Math.round(asNumber * 1000)
    }

    const asDate = Date.parse(value)
    if (Number.isFinite(asDate)) {
      return asDate
    }
  }

  return Date.now()
}

export async function upsertLiveCallSession(params: {
  callSid: string
  slug: string
  status?: string | null
}) {
  const supabase = createAdminClient()
  const now = new Date().toISOString()

  const payload: Record<string, unknown> = {
    call_sid: params.callSid,
    slug: params.slug,
    assistant_muted: true,
    updated_at: now,
  }

  if (params.status) {
    payload.status = normalizeSessionStatus(params.status)
  }

  const { error } = await supabase
    .from('live_calls')
    .upsert(payload, { onConflict: 'call_sid' })

  if (error) {
    throw new Error(`Failed to upsert live call session: ${error.message}`)
  }
}

export async function setLiveCallStatus(callSid: string, status: string, lastError?: string | null) {
  const supabase = createAdminClient()
  const updates: Record<string, unknown> = {
    status: normalizeSessionStatus(status),
    updated_at: new Date().toISOString(),
  }

  if (lastError !== undefined) {
    updates.last_error = lastError
  }

  const { error } = await supabase.from('live_calls').update(updates).eq('call_sid', callSid)
  if (error) {
    throw new Error(`Failed to update live call status: ${error.message}`)
  }
}

export async function setLiveCallAnalyzing(callSid: string, analyzing: boolean) {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('live_calls')
    .update({
      analyzing,
      updated_at: new Date().toISOString(),
    })
    .eq('call_sid', callSid)

  if (error) {
    throw new Error(`Failed to update analyzing state: ${error.message}`)
  }
}

export async function setLiveCallAdvice(callSid: string, advice: CoachingAdvice, lastError: string | null = null) {
  const supabase = createAdminClient()
  const nowIso = new Date().toISOString()

  const { error } = await supabase
    .from('live_calls')
    .update({
      advice,
      last_error: lastError,
      analyzing: false,
      last_advice_at: nowIso,
      updated_at: nowIso,
    })
    .eq('call_sid', callSid)

  if (error) {
    throw new Error(`Failed to store live advice: ${error.message}`)
  }
}

export async function setLiveCallError(callSid: string, message: string) {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('live_calls')
    .update({
      status: 'failed',
      last_error: message,
      analyzing: false,
      updated_at: new Date().toISOString(),
    })
    .eq('call_sid', callSid)

  if (error) {
    throw new Error(`Failed to store live call error: ${error.message}`)
  }
}

export async function appendTranscriptChunk(params: {
  callSid: string
  sourceEventId: string
  speaker: TranscriptSpeaker
  text: string
  isFinal: boolean
  timestamp: number
}) {
  const content = params.text.trim()
  if (!content) return

  const supabase = createAdminClient()
  const payload = {
    call_sid: params.callSid,
    source_event_id: params.sourceEventId,
    speaker: normalizeSpeaker(params.speaker),
    text: content,
    is_final: params.isFinal,
    timestamp_ms: params.timestamp,
  }

  const { error } = await supabase
    .from('live_transcript_chunks')
    .upsert(payload, { onConflict: 'call_sid,source_event_id' })

  if (error) {
    throw new Error(`Failed to append transcript chunk: ${error.message}`)
  }
}

export async function getTranscriptChunks(callSid: string, limit: number): Promise<TranscriptChunk[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('live_transcript_chunks')
    .select('id, speaker, text, timestamp_ms, is_final')
    .eq('call_sid', callSid)
    .order('id', { ascending: false })
    .limit(limit)

  if (error) {
    throw new Error(`Failed to load transcript chunks: ${error.message}`)
  }

  const rows = (data ?? []) as TranscriptRow[]

  return rows
    .slice()
    .reverse()
    .map((row) => ({
      id: String(row.id),
      speaker: toSpeaker(row.speaker),
      text: row.text,
      timestamp: parseTimestampMs(row.timestamp_ms),
    }))
}

export async function getLiveCallSummary(callSid: string): Promise<{
  callSid: string
  slug: string
  status: string
  lastAdviceAt: number | null
} | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('live_calls')
    .select('call_sid, slug, status, last_advice_at')
    .eq('call_sid', callSid)
    .maybeSingle()

  if (error) {
    throw new Error(`Failed to load live call summary: ${error.message}`)
  }

  if (!data) return null

  return {
    callSid: String(data.call_sid),
    slug: String(data.slug),
    status: String(data.status),
    lastAdviceAt: data.last_advice_at ? Date.parse(String(data.last_advice_at)) : null,
  }
}

export async function getLiveSessionSnapshot(
  callSid: string,
  slug: string,
  transcriptLimit = 8,
): Promise<LiveSessionSnapshot | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('live_calls')
    .select('call_sid, slug, status, assistant_muted, analyzing, last_error, advice, updated_at, last_advice_at')
    .eq('call_sid', callSid)
    .eq('slug', slug)
    .maybeSingle()

  if (error) {
    throw new Error(`Failed to load live session: ${error.message}`)
  }

  if (!data) {
    return null
  }

  const row = data as LiveCallRow
  const transcript = await getTranscriptChunks(callSid, transcriptLimit)

  const updatedAt = Date.parse(row.updated_at)

  return {
    callId: row.call_sid,
    slug: row.slug,
    status: normalizeSessionStatus(row.status),
    assistantMuted: row.assistant_muted,
    analyzing: row.analyzing,
    lastError: row.last_error,
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : Date.now(),
    version: 1,
    advice: toAdvice(row.advice),
    transcript,
  }
}
