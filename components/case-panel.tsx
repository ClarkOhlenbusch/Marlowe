'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import { usePrefersReducedMotion } from '@/hooks/use-prefers-reduced-motion'
import { BASE_TEXT_SIZE, PRIMARY_TAP_TARGET, SECONDARY_TEXT_SIZE } from '@/lib/a11y'
import { BRAND_CASE_NAME } from '@/lib/brand'
import { createClient } from '@/lib/supabase/client'
import { mergeIncrementalTranscriptText, normalizeTranscriptText } from '@/lib/transcript-merge'

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
  lastAdviceAt?: number | null
  advice?: LiveAdvice
  transcript?: TranscriptLine[]
  error?: string
}

type LiveAnnouncement = {
  id: string
  priority: 'polite' | 'assertive'
  text: string
}

const STORAGE_KEY_PREFIX = 'live-call:'
const MAX_TRANSCRIPT_LINES = 220
const UTTERANCE_GAP_MS = 1_400
const MAX_SENTENCES_PER_BUBBLE = 3
const MAX_BUBBLE_CHARS = 280
const AUTO_SCROLL_BOTTOM_THRESHOLD_PX = 72
const DEFAULT_VISIBLE_POLL_INTERVAL_MS = 800
const DEFAULT_HIDDEN_POLL_INTERVAL_MS = 2_500
const RECONNECT_NOTE = 'Live updates paused. Reconnecting...'
const POLL_INTERVAL_VISIBLE_MS =
  readPositiveInt(process.env.NEXT_PUBLIC_LIVE_POLL_VISIBLE_MS) ?? DEFAULT_VISIBLE_POLL_INTERVAL_MS
const POLL_INTERVAL_HIDDEN_MS =
  readPositiveInt(process.env.NEXT_PUBLIC_LIVE_POLL_HIDDEN_MS) ?? DEFAULT_HIDDEN_POLL_INTERVAL_MS
const WAITING_ACTIONS_CONNECTING = [
  'Waiting for live audio to connect.',
  'Sit tight and relax. We will coach you as soon as speech starts.',
  'Keep responses short and calm while we listen.',
]
const WAITING_ACTIONS_LISTENING = [
  'Listening now and building guidance from the conversation.',
  'Stay calm and avoid sharing personal info, codes, or payments.',
  'Your next live action will appear here in a moment.',
]

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

function formatSpeakerLabel(speaker: TranscriptLine['speaker']): string {
  if (speaker === 'caller') return 'You'
  if (speaker === 'other') return 'Other caller'
  if (speaker === 'assistant') return 'Assistant'
  return 'Unknown speaker'
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
  const existingLine = lines.find((line) => line.id === nextLine.id)
  const mergedLine = existingLine
    ? {
        ...nextLine,
        speaker: nextLine.speaker === 'unknown' ? existingLine.speaker : nextLine.speaker,
        text: mergeIncrementalTranscriptText(existingLine.text, nextLine.text, {
          isFinal: nextLine.isFinal,
        }),
        timestamp: Math.max(existingLine.timestamp, nextLine.timestamp),
        isFinal: existingLine.isFinal || nextLine.isFinal,
      }
    : nextLine

  const merged = [...lines.filter((line) => line.id !== nextLine.id), mergedLine]

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

function countSentenceBoundaries(text: string): number {
  const matches = text.match(/[.!?]+(?=(?:["')\]]|\s|$))/g)
  return matches?.length ?? 0
}

function endsWithSentenceBoundary(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false
  return /[.!?]["')\]]*$/.test(trimmed)
}

function hasLogicalBubbleBoundary(line: TranscriptLine): boolean {
  const text = normalizeTranscriptText(line.text)
  if (!text) return false

  if (text.length >= MAX_BUBBLE_CHARS) {
    return true
  }

  const sentenceCount = countSentenceBoundaries(text)
  if (sentenceCount >= MAX_SENTENCES_PER_BUBBLE) {
    return true
  }

  return endsWithSentenceBoundary(text)
}

function shouldStartNewUtterance(previous: TranscriptLine, next: TranscriptLine): boolean {
  if (previous.speaker !== next.speaker) {
    return true
  }

  const gapMs = next.timestamp - previous.timestamp
  if (gapMs > UTTERANCE_GAP_MS) {
    return true
  }

  if (!previous.isFinal) {
    return false
  }

  return hasLogicalBubbleBoundary(previous)
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
      text: mergeIncrementalTranscriptText(previous.text, nextEntry.text, {
        isFinal: nextEntry.isFinal,
      }),
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

  return ['Waiting for the next coaching update.']
}

function getWaitingActionItems(params: { callConnected: boolean; analyzing: boolean }): string[] {
  const { callConnected, analyzing } = params
  if (!callConnected) {
    return WAITING_ACTIONS_CONNECTING
  }

  if (analyzing) {
    return WAITING_ACTIONS_LISTENING
  }

  return [
    'Listening for the next clear segment.',
    'You can keep talking normally.',
    'Live actions will update automatically.',
  ]
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
  const [hasLiveAdvice, setHasLiveAdvice] = useState(false)
  const [rawTranscript, setRawTranscript] = useState<TranscriptLine[]>([])
  const [politeAnnouncement, setPoliteAnnouncement] = useState<LiveAnnouncement | null>(null)
  const [assertiveAnnouncement, setAssertiveAnnouncement] = useState<LiveAnnouncement | null>(null)
  const transcriptViewportRef = useRef<HTMLDivElement | null>(null)
  const shouldAutoFollowTranscriptRef = useRef(true)
  const announcementCounterRef = useRef(0)
  const previousPanelStateRef = useRef<PanelState>('idle')
  const previousCallStatusRef = useRef(callStatus)
  const previousAnalyzingRef = useRef(analyzing)
  const previousCaseNoteRef = useRef('')
  const prefersReducedMotion = usePrefersReducedMotion()

  const storageKey = `${STORAGE_KEY_PREFIX}${slug}`
  const supabase = useMemo(() => createClient(), [])
  const callConnected = panelState === 'live' && isConnectedStatus(callStatus)
  const actionItems = useMemo(
    () =>
      hasLiveAdvice
        ? normalizeActionItems(advice)
        : getWaitingActionItems({
            callConnected,
            analyzing,
          }),
    [advice, analyzing, callConnected, hasLiveAdvice],
  )
  const transcript = useMemo(() => compactTranscriptForDisplay(rawTranscript), [rawTranscript])
  const showProtectedNumberCard =
    panelState === 'idle' || panelState === 'starting' || (panelState === 'live' && !callConnected)
  const showPreConnectStatusCard = panelState === 'ended' || !callConnected
  const panelHeading = tenantName?.trim() || BRAND_CASE_NAME

  const announce = useCallback((priority: LiveAnnouncement['priority'], text: string) => {
    const trimmed = text.trim()
    if (!trimmed) return

    const announcement: LiveAnnouncement = {
      id: `${Date.now()}-${announcementCounterRef.current}`,
      priority,
      text: trimmed,
    }

    announcementCounterRef.current += 1

    if (priority === 'assertive') {
      setAssertiveAnnouncement(announcement)
      return
    }

    setPoliteAnnouncement(announcement)
  }, [])

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
    if (!error.trim()) return
    announce('assertive', error)
  }, [announce, error])

  useEffect(() => {
    const previousState = previousPanelStateRef.current
    if (previousState === panelState) {
      return
    }

    if (panelState === 'starting') {
      announce('polite', 'Starting silent monitor. We are calling your saved number.')
    } else if (panelState === 'live' && callConnected) {
      announce('polite', 'Call connected. Live coaching is active.')
    } else if (panelState === 'ended') {
      announce('assertive', 'Call ended. You can start a new session.')
    } else if (panelState === 'error') {
      announce('assertive', error || 'Session failed. Please try again.')
    } else if (panelState === 'idle' && previousState !== 'idle') {
      announce('polite', 'Ready for a new session.')
    }

    previousPanelStateRef.current = panelState
  }, [announce, callConnected, error, panelState])

  useEffect(() => {
    if (previousCallStatusRef.current === callStatus) {
      return
    }

    previousCallStatusRef.current = callStatus
    if (panelState === 'idle') {
      return
    }

    announce('polite', `Call status: ${formatStatusLabel(callStatus)}.`)
  }, [announce, callStatus, panelState])

  useEffect(() => {
    if (analyzing && !previousAnalyzingRef.current) {
      announce('polite', 'Reviewing the latest part of the call.')
    }

    previousAnalyzingRef.current = analyzing
  }, [analyzing, announce])

  useEffect(() => {
    if (!caseNote.trim() || caseNote === previousCaseNoteRef.current) {
      return
    }

    const normalized = caseNote.toLowerCase()
    const isCritical =
      normalized.includes('fail') ||
      normalized.includes('error') ||
      normalized.includes('expired')

    announce(isCritical ? 'assertive' : 'polite', caseNote)
    previousCaseNoteRef.current = caseNote
  }, [announce, caseNote])

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

      if (data.lastAdviceAt === null) {
        setHasLiveAdvice(false)
      } else if (typeof data.lastAdviceAt === 'number' && Number.isFinite(data.lastAdviceAt)) {
        setHasLiveAdvice(true)
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

      if (row.last_advice_at === null) {
        setHasLiveAdvice(false)
      } else if (typeof row.last_advice_at === 'string') {
        const lastAdviceAt = Date.parse(row.last_advice_at)
        if (Number.isFinite(lastAdviceAt)) {
          setHasLiveAdvice(true)
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
    const viewport = transcriptViewportRef.current
    if (!viewport) return

    const updateAutoFollow = () => {
      const distanceFromBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight
      shouldAutoFollowTranscriptRef.current = distanceFromBottom <= AUTO_SCROLL_BOTTOM_THRESHOLD_PX
    }

    updateAutoFollow()
    viewport.addEventListener('scroll', updateAutoFollow, { passive: true })

    return () => {
      viewport.removeEventListener('scroll', updateAutoFollow)
    }
  }, [panelState, callId])

  useEffect(() => {
    if (transcript.length === 0) return
    const viewport = transcriptViewportRef.current
    if (!viewport) return

    if (!shouldAutoFollowTranscriptRef.current && transcript.length > 1) {
      return
    }

    viewport.scrollTo({
      top: viewport.scrollHeight,
      behavior: prefersReducedMotion ? 'auto' : 'smooth',
    })
  }, [prefersReducedMotion, transcript])

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
    setHasLiveAdvice(false)

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
    setHasLiveAdvice(false)
    setRawTranscript([])
    shouldAutoFollowTranscriptRef.current = true
    window.sessionStorage.removeItem(storageKey)
  }

  return (
    <section aria-labelledby="live-coach-title" className="flex w-full max-w-md flex-col gap-4 pb-2">
      <p key={politeAnnouncement?.id ?? 'polite'} className="sr-only" role="status" aria-live="polite">
        {politeAnnouncement?.text ?? ''}
      </p>
      <p key={assertiveAnnouncement?.id ?? 'assertive'} className="sr-only" role="alert" aria-live="assertive">
        {assertiveAnnouncement?.text ?? ''}
      </p>

      <header className="flex flex-col items-center gap-1 text-center">
        <h1 id="live-coach-title" className="font-sans text-2xl font-semibold text-foreground">
          {panelHeading}
        </h1>
      </header>

      {showProtectedNumberCard && (
        <section
          aria-label="Saved phone number and call status"
          className="flex items-center justify-between rounded-xl border border-border bg-card/70 px-4 py-3"
        >
          <div className="flex flex-col gap-1">
            <p className="font-sans text-sm text-muted-foreground">Protected number</p>
            <p className="font-sans text-lg font-semibold text-foreground">{maskedPhone}</p>
          </div>
          {panelState !== 'idle' && (
            <div className="text-right">
              <p className="font-sans text-sm text-muted-foreground">Status</p>
              <p className="font-sans text-base font-semibold text-foreground">
                {panelState === 'starting' ? 'Starting' : formatStatusLabel(callStatus)}
              </p>
            </div>
          )}
        </section>
      )}

      {panelState === 'idle' && (
        <section aria-labelledby="start-monitor-heading" className="rounded-2xl border border-border bg-card/70 px-4 py-5">
          <h2 id="start-monitor-heading" className="font-sans text-xl font-semibold text-foreground">
            Start silent monitor
          </h2>
          <p className="mt-2 font-sans text-lg leading-relaxed text-foreground">
            Tap once to start silent coaching on suspicious calls.
          </p>
          <Button
            onClick={handleStartMonitor}
            size="lg"
            style={{ minHeight: PRIMARY_TAP_TARGET, fontSize: BASE_TEXT_SIZE }}
            className="mt-4 w-full bg-primary font-sans font-semibold text-primary-foreground hover:bg-primary/90"
          >
            <Phone className="mr-2 h-5 w-5" />
            Start silent monitor
          </Button>
          <p className="mt-3 font-sans text-base text-muted-foreground">
            Keep this screen open. Instructions update in real time.
          </p>
        </section>
      )}

      {panelState === 'starting' && (
        <section
          role="status"
          aria-live="polite"
          className="flex w-full flex-col items-center gap-3 rounded-2xl border border-border bg-card px-6 py-8"
        >
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <h2 className="text-center font-sans text-xl font-semibold text-foreground">Starting monitor</h2>
          <p className="text-center font-sans text-base text-muted-foreground">
            Keep this page open while the call connects.
          </p>
        </section>
      )}

      {(panelState === 'live' || panelState === 'ended') && (
        <div className="flex w-full flex-col gap-3">
          {showPreConnectStatusCard && (
            <section aria-live="polite" className="rounded-2xl border border-border bg-card/80 px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-sans text-base font-semibold text-foreground">{formatStatusLabel(callStatus)}</h2>
                <p className="font-sans text-sm text-muted-foreground">Updated {formatTime(lastUpdated)}</p>
              </div>
              <p className="mt-2 font-sans text-base text-muted-foreground">
                Silent mode: {assistantMuted ? 'On' : 'Starting'}
              </p>
              {analyzing && (
                <p className="mt-1 font-sans text-base text-muted-foreground">
                  Reading the latest part of the call.
                </p>
              )}
              {caseNote && <p className="mt-2 font-sans text-base text-foreground">{caseNote}</p>}
            </section>
          )}

          {!showPreConnectStatusCard && (analyzing || caseNote) && (
            <section className="px-1" aria-live="polite">
              {analyzing && (
                <p className="font-sans text-base text-muted-foreground">
                  Reading the latest part of the call.
                </p>
              )}
              {caseNote && <p className="mt-1 font-sans text-base text-foreground">{caseNote}</p>}
            </section>
          )}

          <section className="rounded-2xl border border-primary/40 bg-primary/10 px-4 py-4">
            <h2 className="font-sans text-lg font-semibold text-foreground">What to do now</h2>
            <ol className="mt-3 flex list-none flex-col gap-2">
              {actionItems.map((item, index) => (
                <li
                  key={`${item}-${index}`}
                  className={`flex items-start gap-3 rounded-xl border px-3 py-3 ${
                    index === 0
                      ? 'border-primary/50 bg-primary/15'
                      : 'border-border/80 bg-card/60'
                  }`}
                >
                  <span
                    className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-sans text-sm font-semibold ${
                      index === 0
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-secondary text-foreground'
                    }`}
                  >
                    {index + 1}
                  </span>
                  <p
                    className={`font-sans leading-relaxed ${
                      index === 0 ? 'text-lg text-foreground' : 'text-base text-muted-foreground'
                    }`}
                  >
                    {item}
                  </p>
                </li>
              ))}
            </ol>
          </section>

          <section className="rounded-2xl border border-border bg-card px-3 py-3">
            <h2 className="px-1 font-sans text-lg font-semibold text-foreground">Live transcript</h2>
            <p className="mt-1 px-1 font-sans text-sm text-muted-foreground">New lines will appear automatically.</p>
            <div
              ref={transcriptViewportRef}
              role="log"
              aria-live="polite"
              aria-relevant="additions text"
              aria-atomic="false"
              aria-label="Live call transcript"
              tabIndex={0}
              className="mt-3 flex h-[44dvh] min-h-[280px] flex-col gap-2 overflow-y-auto px-1 pb-1"
            >
              {transcript.length === 0 && (
                <p className="mt-2 text-center font-sans text-base text-muted-foreground">
                  Waiting for live transcript.
                </p>
              )}
              {transcript.map((line) => (
                <article
                  key={line.id}
                  aria-label={`${formatSpeakerLabel(line.speaker)} said`}
                  className={`mx-auto w-fit max-w-[95%] rounded-2xl border px-4 py-3 transition-colors duration-150 ${
                    line.isFinal
                      ? 'border-border/70 bg-secondary/80'
                      : 'border-primary/30 bg-primary/5'
                  }`}
                >
                  <p
                    className={`font-sans text-[17px] leading-relaxed whitespace-pre-wrap break-words ${
                      line.isFinal ? 'text-foreground' : 'italic text-foreground/90'
                    }`}
                  >
                    {line.text}
                  </p>
                </article>
              ))}
            </div>
          </section>

          <section className={`rounded-2xl border px-4 py-4 ${riskTheme.card}`}>
            <div className="flex items-center justify-between">
              <h2 className="font-sans text-lg font-semibold text-foreground">Scam probability</h2>
              <riskTheme.Icon aria-hidden="true" className={`h-5 w-5 ${riskTheme.label}`} />
            </div>
            <div className="mt-2 flex items-end justify-between gap-3">
              <p className={`font-sans text-4xl font-semibold ${riskTheme.label}`}>{advice.riskScore}%</p>
              <p className="font-sans text-base font-medium text-foreground">{advice.riskLevel} risk</p>
            </div>
            <div
              className="mt-3 h-2 w-full rounded-full bg-background/70"
              role="progressbar"
              aria-label="Scam probability"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={advice.riskScore}
            >
              <div
                className={`h-2 rounded-full transition-[width] duration-700 ease-out ${riskTheme.meter}`}
                style={{ width: `${advice.riskScore}%` }}
              />
            </div>
            <p className="mt-2 font-sans text-base text-muted-foreground">
              Scam probability {advice.riskScore} percent, {advice.riskLevel} risk.
            </p>
            <p className="mt-3 font-sans text-base leading-relaxed text-foreground">{advice.feedback}</p>
          </section>

          <Button
            onClick={resetSession}
            variant="outline"
            style={{ minHeight: PRIMARY_TAP_TARGET, fontSize: SECONDARY_TEXT_SIZE }}
            className="font-sans font-semibold"
          >
            <RotateCcw className="mr-2 h-4 w-4" />
            New session
          </Button>
        </div>
      )}

      {panelState === 'error' && (
        <section
          role="alert"
          aria-live="assertive"
          className="flex w-full flex-col items-center gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 px-6 py-8"
        >
          <AlertTriangle className="h-8 w-8 text-destructive" />
          <h2 className="text-center font-sans text-xl font-semibold text-destructive">Session failed</h2>
          <p className="text-center font-sans text-base text-foreground">{error || 'Unable to start session.'}</p>
          <Button
            onClick={handleStartMonitor}
            variant="outline"
            style={{ minHeight: PRIMARY_TAP_TARGET, fontSize: SECONDARY_TEXT_SIZE }}
            className="mt-2 font-sans font-semibold"
          >
            <RotateCcw className="mr-2 h-4 w-4" />
            Retry
          </Button>
        </section>
      )}

      {caseNote && panelState === 'idle' && (
        <section className="w-full rounded-xl border border-border bg-card px-4 py-3">
          <p className="font-sans text-base text-foreground">{caseNote}</p>
        </section>
      )}

      <Link
        href={`/t/${slug}/setup`}
        style={{ minHeight: PRIMARY_TAP_TARGET, fontSize: SECONDARY_TEXT_SIZE }}
        className="self-center rounded-md px-3 py-3 font-sans font-semibold text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
      >
        Change number
      </Link>
    </section>
  )
}
