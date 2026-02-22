'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  Loader2,
  Phone,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { BRAND_NAME } from '@/lib/brand'
import { createClient } from '@/lib/supabase/client'

type PanelState = 'idle' | 'starting' | 'live' | 'ended' | 'error'
type RiskLevel = 'low' | 'medium' | 'high'

type TranscriptLine = {
  id: string
  speaker: 'caller' | 'other' | 'assistant' | 'unknown'
  text: string
  timestamp: number
  isFinal: boolean
}

type LiveAdvice = {
  riskScore: number
  riskLevel: RiskLevel
  feedback: string
  whatToSay: string
  whatToDo: string
  nextSteps: string[]
  confidence: number
  updatedAt: number
}

type LiveSessionPayload = {
  ok: boolean
  status?: string
  assistantMuted?: boolean
  analyzing?: boolean
  lastError?: string | null
  updatedAt?: number
  advice?: LiveAdvice
  transcript?: TranscriptLine[]
  error?: string
}

const STORAGE_KEY_PREFIX = 'live-call:'
const MAX_TRANSCRIPT_LINES = 40
const UTTERANCE_GAP_MS = 1_400
const DEFAULT_VISIBLE_POLL_INTERVAL_MS = 800
const DEFAULT_HIDDEN_POLL_INTERVAL_MS = 2_500
const RECONNECT_NOTE = 'Live updates paused. Reconnecting...'
const POLL_INTERVAL_VISIBLE_MS =
  readPositiveInt(process.env.NEXT_PUBLIC_LIVE_POLL_VISIBLE_MS) ?? DEFAULT_VISIBLE_POLL_INTERVAL_MS
const POLL_INTERVAL_HIDDEN_MS =
  readPositiveInt(process.env.NEXT_PUBLIC_LIVE_POLL_HIDDEN_MS) ?? DEFAULT_HIDDEN_POLL_INTERVAL_MS

function readPositiveInt(value: string | undefined): number | null {
  if (!value?.trim()) {
    return null
  }

  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null
  }

  return parsed
}

function createDefaultAdvice(): LiveAdvice {
  return {
    riskScore: 20,
    riskLevel: 'low',
    feedback: 'Listening for risk signals. Stay calm and ask for verification.',
    whatToSay: 'Can you share your full name, department, and official callback number?',
    whatToDo: 'Do not share one-time codes, account numbers, or payment details.',
    nextSteps: [
      'Ask them to repeat their claim clearly.',
      'Say you will verify using an official number.',
    ],
    confidence: 0.3,
    updatedAt: Date.now(),
  }
}

function isTerminalStatus(status: string): boolean {
  const normalized = status.toLowerCase()
  return (
    normalized.includes('end') ||
    normalized.includes('complete') ||
    normalized.includes('cancel') ||
    normalized.includes('fail') ||
    normalized.includes('error')
  )
}

function formatStatusLabel(status: string): string {
  const normalized = status.toLowerCase()

  if (normalized.includes('queue')) return 'Queueing call'
  if (normalized.includes('ring')) return 'Ringing'
  if (normalized.includes('in-progress') || normalized.includes('active')) return 'Live'
  if (normalized.includes('end') || normalized.includes('complete')) return 'Call ended'
  if (normalized.includes('fail') || normalized.includes('error') || normalized.includes('busy')) {
    return 'Call failed'
  }

  return 'Connecting'
}

function isConnectedStatus(status: string): boolean {
  const normalized = status.toLowerCase()
  return (
    normalized.includes('in-progress') ||
    normalized.includes('in progress') ||
    normalized.includes('active') ||
    normalized.includes('answer')
  )
}

function formatTime(timestamp: number | null): string {
  if (!timestamp) return '--'
  return new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
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

function toSpeaker(value: unknown): TranscriptLine['speaker'] {
  if (typeof value !== 'string') return 'unknown'
  const normalized = value.toLowerCase()
  if (normalized === 'caller') return 'caller'
  if (normalized === 'other') return 'other'
  if (normalized === 'assistant') return 'assistant'
  return 'unknown'
}

function mergeTranscriptLine(lines: TranscriptLine[], nextLine: TranscriptLine): TranscriptLine[] {
  const merged = [...lines.filter((line) => line.id !== nextLine.id), nextLine]

  merged.sort((a, b) => {
    if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp

    const aNum = Number(a.id)
    const bNum = Number(b.id)

    if (Number.isFinite(aNum) && Number.isFinite(bNum)) {
      return aNum - bNum
    }

    return a.id.localeCompare(b.id)
  })

  if (merged.length <= MAX_TRANSCRIPT_LINES) return merged
  return merged.slice(-MAX_TRANSCRIPT_LINES)
}

function normalizeTranscriptText(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function normalizeToken(value: string): string {
  const lowered = value.toLowerCase()
  const stripped = lowered.replace(/^[^a-z0-9']+|[^a-z0-9']+$/g, '')
  return stripped || lowered
}

function findWordOverlap(previousWords: string[], nextWords: string[]): number {
  const maxOverlap = Math.min(previousWords.length, nextWords.length)

  for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
    let matched = true

    for (let index = 0; index < overlap; index += 1) {
      const previousToken = normalizeToken(previousWords[previousWords.length - overlap + index] ?? '')
      const nextToken = normalizeToken(nextWords[index] ?? '')

      if (!previousToken || !nextToken || previousToken !== nextToken) {
        matched = false
        break
      }
    }

    if (matched) {
      return overlap
    }
  }

  return 0
}

function collapseDuplicateWords(words: string[]): string[] {
  const deduped: string[] = []
  let previousToken = ''

  for (const word of words) {
    const token = normalizeToken(word)
    if (token && token === previousToken) {
      continue
    }

    deduped.push(word)
    previousToken = token
  }

  return deduped
}

function mergeUtteranceText(previousText: string, nextText: string): string {
  const previous = normalizeTranscriptText(previousText)
  const next = normalizeTranscriptText(nextText)

  if (!previous) return next
  if (!next) return previous

  const previousLower = previous.toLowerCase()
  const nextLower = next.toLowerCase()

  if (previousLower === nextLower) {
    return previous
  }

  if (nextLower.startsWith(previousLower)) {
    return next
  }

  if (previousLower.startsWith(nextLower)) {
    return previous
  }

  const previousWords = previous.split(' ')
  const nextWords = next.split(' ')
  const overlap = findWordOverlap(previousWords, nextWords)

  if (overlap === 0) {
    return next
  }

  return collapseDuplicateWords([...previousWords, ...nextWords.slice(overlap)]).join(' ')
}

function shouldStartNewUtterance(previous: TranscriptLine, next: TranscriptLine): boolean {
  if (previous.speaker !== next.speaker) {
    return true
  }

  if (previous.isFinal) {
    return true
  }

  return next.timestamp - previous.timestamp > UTTERANCE_GAP_MS
}

function compactTranscriptForDisplay(lines: TranscriptLine[]): TranscriptLine[] {
  if (lines.length === 0) {
    return []
  }

  const ordered = lines.slice().sort((a, b) => {
    if (a.timestamp !== b.timestamp) {
      return a.timestamp - b.timestamp
    }

    const aNum = Number(a.id)
    const bNum = Number(b.id)
    if (Number.isFinite(aNum) && Number.isFinite(bNum)) {
      return aNum - bNum
    }

    return a.id.localeCompare(b.id)
  })

  const compacted: TranscriptLine[] = []

  for (const entry of ordered) {
    const normalizedText = normalizeTranscriptText(entry.text)
    if (!normalizedText) {
      continue
    }

    const nextEntry: TranscriptLine = {
      ...entry,
      text: normalizedText,
    }

    const previous = compacted[compacted.length - 1]
    if (!previous || shouldStartNewUtterance(previous, nextEntry)) {
      compacted.push(nextEntry)
      continue
    }

    compacted[compacted.length - 1] = {
      ...previous,
      text: mergeUtteranceText(previous.text, nextEntry.text),
      timestamp: Math.max(previous.timestamp, nextEntry.timestamp),
      isFinal: previous.isFinal || nextEntry.isFinal,
    }
  }

  if (compacted.length <= MAX_TRANSCRIPT_LINES) {
    return compacted
  }

  return compacted.slice(-MAX_TRANSCRIPT_LINES)
}

function normalizeActionItems(advice: LiveAdvice): string[] {
  const values = [advice.whatToDo, ...advice.nextSteps]
  const deduped: string[] = []
  const seen = new Set<string>()

  for (const value of values) {
    const trimmed = value.trim()
    if (!trimmed) continue
    const key = trimmed.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(trimmed)
  }

  if (deduped.length > 0) {
    return deduped.slice(0, 3)
  }

  return [createDefaultAdvice().whatToDo]
}

export function CasePanel({
  slug,
  maskedPhone,
  tenantName,
}: {
  slug: string
  maskedPhone: string
  tenantName?: string | null
}) {
  const [panelState, setPanelState] = useState<PanelState>('idle')
  const [callId, setCallId] = useState<string | null>(null)
  const [callStatus, setCallStatus] = useState('queued')
  const [assistantMuted, setAssistantMuted] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [caseNote, setCaseNote] = useState('')
  const [error, setError] = useState('')
  const [lastUpdated, setLastUpdated] = useState<number | null>(null)
  const [advice, setAdvice] = useState<LiveAdvice>(createDefaultAdvice())
  const [rawTranscript, setRawTranscript] = useState<TranscriptLine[]>([])
  const transcriptViewportRef = useRef<HTMLDivElement | null>(null)

  const storageKey = `${STORAGE_KEY_PREFIX}${slug}`
  const supabase = useMemo(() => createClient(), [])
  const actionItems = useMemo(() => normalizeActionItems(advice), [advice])
  const transcript = useMemo(() => compactTranscriptForDisplay(rawTranscript), [rawTranscript])
  const callConnected = panelState === 'live' && isConnectedStatus(callStatus)
  const showCaseHeader = panelState === 'idle'
  const showProtectedNumberCard =
    panelState === 'idle' || panelState === 'starting' || (panelState === 'live' && !callConnected)
  const showPreConnectStatusCard = panelState === 'ended' || !callConnected

  useEffect(() => {
    const existingCallId = window.sessionStorage.getItem(storageKey)

    if (!existingCallId) {
      return
    }

    setCallId(existingCallId)
    setPanelState('live')
    setCaseNote('Reconnected to your active monitor session.')
  }, [storageKey])

  useEffect(() => {
    if (!callId) return
    const activeCallId = callId

    let cancelled = false
    let inFlight = false

    function applySessionPayload(data: LiveSessionPayload) {
      if (typeof data.status === 'string') {
        setCallStatus(data.status)
        if (isTerminalStatus(data.status)) {
          setPanelState('ended')
          window.sessionStorage.removeItem(storageKey)
        } else {
          setPanelState('live')
        }
      }

      setAssistantMuted(Boolean(data.assistantMuted))
      setAnalyzing(Boolean(data.analyzing))

      if (typeof data.updatedAt === 'number') {
        setLastUpdated(data.updatedAt)
      }

      if (data.advice) {
        setAdvice(data.advice)
      }

      if (Array.isArray(data.transcript)) {
        const normalized = data.transcript
          .slice(-MAX_TRANSCRIPT_LINES)
          .map((line) => ({
            ...line,
            text: normalizeTranscriptText(line.text),
            isFinal: line.isFinal !== false,
          }))

        const merged = normalized.reduce<TranscriptLine[]>(
          (previous, line) => mergeTranscriptLine(previous, line),
          [],
        )

        setRawTranscript(merged)
      }

      if (data.lastError) {
        setCaseNote(data.lastError)
      }
    }

    function applyLiveCallRow(row: Record<string, unknown>) {
      if (typeof row.status === 'string') {
        setCallStatus(row.status)
        if (isTerminalStatus(row.status)) {
          setPanelState('ended')
          window.sessionStorage.removeItem(storageKey)
        } else {
          setPanelState('live')
        }
      }

      if (typeof row.assistant_muted === 'boolean') {
        setAssistantMuted(row.assistant_muted)
      }

      if (typeof row.analyzing === 'boolean') {
        setAnalyzing(row.analyzing)
      }

      if (typeof row.updated_at === 'string') {
        const updatedAt = Date.parse(row.updated_at)
        if (Number.isFinite(updatedAt)) {
          setLastUpdated(updatedAt)
        }
      }

      const advicePayload = asRecord(row.advice)
      if (advicePayload) {
        setAdvice(advicePayload as LiveAdvice)
      }

      if (typeof row.last_error === 'string' && row.last_error.trim()) {
        setCaseNote(row.last_error)
      }
    }

    function applyTranscriptRow(row: Record<string, unknown>) {
      const rawId = row.id
      const text = row.text

      if ((typeof rawId !== 'number' && typeof rawId !== 'string') || typeof text !== 'string' || !text.trim()) {
        return
      }

      const line: TranscriptLine = {
        id: String(rawId),
        speaker: toSpeaker(row.speaker),
        text: normalizeTranscriptText(text),
        timestamp: parseTimestampMs(row.timestamp_ms),
        isFinal: typeof row.is_final === 'boolean' ? row.is_final : true,
      }

      setRawTranscript((previous) => mergeTranscriptLine(previous, line))
    }

    async function pollLiveSession() {
      if (cancelled || inFlight) return
      inFlight = true

      try {
        const res = await fetch(
          `/api/call/live?slug=${encodeURIComponent(slug)}&callId=${encodeURIComponent(activeCallId)}`,
          {
            cache: 'no-store',
          }
        )

        const data: LiveSessionPayload = await res.json()

        if (cancelled) return

        if (!res.ok || !data.ok) {
          if (res.status === 404) {
            setPanelState('error')
            setError('Live session expired. Start a new monitor session.')
            window.sessionStorage.removeItem(storageKey)
          }
          return
        }

        applySessionPayload(data)
      } catch {
        if (!cancelled) {
          setCaseNote(RECONNECT_NOTE)
        }
      } finally {
        inFlight = false
      }
    }

    function getPollIntervalMs(): number {
      if (document.visibilityState === 'hidden') {
        return POLL_INTERVAL_HIDDEN_MS
      }
      return POLL_INTERVAL_VISIBLE_MS
    }

    let fallbackTimer = window.setInterval(() => {
      void pollLiveSession()
    }, getPollIntervalMs())

    function restartFallbackTimer() {
      window.clearInterval(fallbackTimer)
      fallbackTimer = window.setInterval(() => {
        void pollLiveSession()
      }, getPollIntervalMs())
    }

    function handleVisibilityChange() {
      restartFallbackTimer()
      if (document.visibilityState === 'visible') {
        void pollLiveSession()
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)

    const channel = supabase
      .channel(`live:${slug}:${activeCallId}:${Date.now()}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'live_calls',
          filter: `call_sid=eq.${activeCallId}`,
        },
        (payload) => {
          const row = asRecord(payload.new)
          if (!row) return

          applyLiveCallRow(row)
        },
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'live_transcript_chunks',
          filter: `call_sid=eq.${activeCallId}`,
        },
        (payload) => {
          const row = asRecord(payload.new)
          if (!row) return

          applyTranscriptRow(row)
        },
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          setCaseNote((previous) => (previous === RECONNECT_NOTE ? '' : previous))
          return
        }
      })

    void pollLiveSession()

    return () => {
      cancelled = true
      window.clearInterval(fallbackTimer)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      void supabase.removeChannel(channel)
    }
  }, [callId, slug, storageKey, supabase])

  useEffect(() => {
    if (transcript.length === 0) return
    const viewport = transcriptViewportRef.current
    if (!viewport) return

    viewport.scrollTo({
      top: viewport.scrollHeight,
      behavior: 'smooth',
    })
  }, [transcript])

  const riskTheme = useMemo(() => {
    if (advice.riskLevel === 'high') {
      return {
        card: 'border-destructive/40 bg-destructive/10',
        label: 'text-destructive',
        meter: 'bg-destructive',
        Icon: ShieldAlert,
      }
    }

    if (advice.riskLevel === 'medium') {
      return {
        card: 'border-amber-500/40 bg-amber-500/10',
        label: 'text-amber-500',
        meter: 'bg-amber-500',
        Icon: ShieldQuestion,
      }
    }

    return {
      card: 'border-emerald-500/40 bg-emerald-500/10',
      label: 'text-emerald-500',
      meter: 'bg-emerald-500',
      Icon: ShieldCheck,
    }
  }, [advice.riskLevel])

  async function handleStartMonitor() {
    setPanelState('starting')
    setError('')
    setCaseNote('Calling your saved number...')

    try {
      const res = await fetch('/api/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug }),
      })

      const data = await res.json()

      if (!res.ok || !data.ok || !data.callId) {
        setPanelState('error')
        setError(data.error || 'Unable to start monitor session. Try again.')
        return
      }

      const nextCallId = String(data.callId)
      setCallId(nextCallId)
      setCallStatus(typeof data.status === 'string' ? data.status : 'queued')
      setPanelState('live')
      setCaseNote('Answer the incoming call. We listen silently and coach you on this screen.')
      window.sessionStorage.setItem(storageKey, nextCallId)
    } catch {
      setPanelState('error')
      setError('Connection failed. Check your network and try again.')
    }
  }

  function resetSession() {
    setPanelState('idle')
    setCallId(null)
    setCallStatus('queued')
    setAssistantMuted(false)
    setAnalyzing(false)
    setCaseNote('')
    setError('')
    setLastUpdated(null)
    setAdvice(createDefaultAdvice())
    setRawTranscript([])
    window.sessionStorage.removeItem(storageKey)
  }

  return (
    <div className="flex w-full max-w-md flex-col gap-4">
      {showCaseHeader && (
        <div className="flex flex-col gap-1">
          <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground/80">
            {BRAND_NAME}
          </p>
          {tenantName && (
            <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">{tenantName}</p>
          )}
        </div>
      )}

      {showProtectedNumberCard && (
        <div className="flex items-center justify-between rounded-xl border border-border bg-card/70 px-4 py-3">
          <div className="flex flex-col gap-1">
            <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Protected Number
            </p>
            <p className="font-mono text-base text-foreground">{maskedPhone}</p>
          </div>
          {panelState !== 'idle' && (
            <div className="text-right">
              <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Status</p>
              <p className="font-mono text-xs uppercase tracking-widest text-foreground">
                {panelState === 'starting' ? 'Starting' : formatStatusLabel(callStatus)}
              </p>
            </div>
          )}
        </div>
      )}

      {panelState === 'idle' && (
        <div className="flex w-full flex-col gap-3 rounded-2xl border border-border bg-card/70 px-4 py-5">
          <p className="font-mono text-sm leading-relaxed text-foreground">
            Tap once to start silent coaching on suspicious calls.
          </p>
          <Button
            onClick={handleStartMonitor}
            size="lg"
            className="h-14 w-full bg-primary font-mono text-sm font-semibold uppercase tracking-widest text-primary-foreground hover:bg-primary/90"
          >
            <Phone className="mr-2 h-5 w-5" />
            Start Silent Monitor
          </Button>
          <p className="font-mono text-xs text-muted-foreground">
            Keep this screen open. Instructions update in real time.
          </p>
        </div>
      )}

      {panelState === 'starting' && (
        <div className="flex w-full flex-col items-center gap-3 rounded-2xl border border-border bg-card px-6 py-8">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="font-mono text-sm uppercase tracking-widest text-muted-foreground">Starting monitor...</p>
          <p className="text-center font-mono text-xs text-muted-foreground">
            Keep this page open while the call connects.
          </p>
        </div>
      )}

      {(panelState === 'live' || panelState === 'ended') && (
        <div className="flex w-full flex-col gap-3">
          {showPreConnectStatusCard && (
            <div className="rounded-2xl border border-border bg-card/80 px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
                  {formatStatusLabel(callStatus)}
                </p>
                <p className="font-mono text-xs text-muted-foreground">Updated {formatTime(lastUpdated)}</p>
              </div>
              <p className="mt-2 font-mono text-xs text-muted-foreground">
                Silent mode: {assistantMuted ? 'on' : 'starting'}
              </p>
              {analyzing && (
                <p className="mt-1 font-mono text-xs text-muted-foreground">
                  Reading the latest part of the call...
                </p>
              )}
              {caseNote && <p className="mt-2 font-mono text-sm text-foreground">{caseNote}</p>}
            </div>
          )}

          {!showPreConnectStatusCard && (analyzing || caseNote) && (
            <div className="px-1">
              {analyzing && (
                <p className="font-mono text-xs text-muted-foreground">Reading the latest part of the call...</p>
              )}
              {caseNote && <p className="mt-1 font-mono text-sm text-foreground">{caseNote}</p>}
            </div>
          )}

          <div className="rounded-2xl border border-primary/40 bg-primary/10 px-4 py-4">
            <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">What To Do</p>
            <div className="mt-3 flex flex-col gap-2">
              {actionItems.map((item, index) => (
                <div
                  key={`${item}-${index}`}
                  className={`flex items-start gap-3 rounded-xl border px-3 py-2 ${
                    index === 0
                      ? 'border-primary/50 bg-primary/15'
                      : 'border-border/80 bg-card/60'
                  }`}
                >
                  <span
                    className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full font-mono text-xs ${
                      index === 0
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-secondary text-muted-foreground'
                    }`}
                  >
                    {index + 1}
                  </span>
                  <p
                    className={`font-mono leading-relaxed ${
                      index === 0 ? 'text-base text-foreground' : 'text-sm text-muted-foreground'
                    }`}
                  >
                    {item}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-card px-3 py-3">
            <p className="px-1 font-mono text-xs uppercase tracking-widest text-muted-foreground">Live Transcript</p>
            <div
              ref={transcriptViewportRef}
              className="mt-3 flex h-[44dvh] min-h-[280px] flex-col gap-2 overflow-y-auto px-1 pb-1"
            >
              {transcript.length === 0 && (
                <p className="mt-2 text-center font-mono text-sm text-muted-foreground">
                  Waiting for live transcript...
                </p>
              )}
              {transcript.map((line) => (
                <div
                  key={line.id}
                  className={`mx-auto w-full max-w-[95%] rounded-2xl border px-4 py-3 ${
                    line.isFinal
                      ? 'border-border/70 bg-secondary/80'
                      : 'border-primary/30 bg-primary/5'
                  }`}
                >
                  <p
                    className={`text-center font-mono text-[15px] leading-relaxed ${
                      line.isFinal ? 'text-foreground' : 'italic text-foreground/90'
                    }`}
                  >
                    {line.text}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className={`rounded-2xl border px-4 py-4 ${riskTheme.card}`}>
            <div className="flex items-center justify-between">
              <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Scam Probability</p>
              <riskTheme.Icon className={`h-4 w-4 ${riskTheme.label}`} />
            </div>
            <div className="mt-2 flex items-end justify-between gap-3">
              <p className={`font-mono text-3xl font-semibold ${riskTheme.label}`}>{advice.riskScore}%</p>
              <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">{advice.riskLevel}</p>
            </div>
            <div className="mt-3 h-2 w-full rounded-full bg-background/70">
              <div
                className={`h-2 rounded-full transition-[width] duration-700 ease-out ${riskTheme.meter}`}
                style={{ width: `${advice.riskScore}%` }}
              />
            </div>
            <p className="mt-3 font-mono text-sm leading-relaxed text-foreground">{advice.feedback}</p>
          </div>

          <Button
            onClick={resetSession}
            variant="outline"
            size="sm"
            className="font-mono text-xs uppercase tracking-widest"
          >
            <RotateCcw className="mr-2 h-3 w-3" />
            New Session
          </Button>
        </div>
      )}

      {panelState === 'error' && (
        <div className="flex w-full flex-col items-center gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 px-6 py-8">
          <AlertTriangle className="h-8 w-8 text-destructive" />
          <p className="font-mono text-sm font-semibold uppercase tracking-widest text-destructive">Session Failed</p>
          <p className="text-center font-mono text-sm text-foreground">{error || 'Unable to start session.'}</p>
          <Button
            onClick={handleStartMonitor}
            variant="outline"
            size="sm"
            className="mt-2 font-mono text-xs uppercase tracking-widest"
          >
            <RotateCcw className="mr-2 h-3 w-3" />
            Retry
          </Button>
        </div>
      )}

      {caseNote && panelState === 'idle' && (
        <div className="w-full rounded-xl border border-border bg-card px-4 py-3">
          <p className="font-mono text-sm text-foreground">{caseNote}</p>
        </div>
      )}

      <Link
        href={`/t/${slug}/setup`}
        className="self-center font-mono text-xs uppercase tracking-widest text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
      >
        Change number
      </Link>
    </div>
  )
}
