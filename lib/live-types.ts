export type RiskLevel = 'low' | 'medium' | 'high'

export type SessionStatus =
  | 'queued'
  | 'ringing'
  | 'in-progress'
  | 'ended'
  | 'failed'
  | 'unknown'

export type TranscriptSpeaker = 'caller' | 'other' | 'assistant' | 'unknown'

export type TranscriptChunk = {
  id: string
  speaker: TranscriptSpeaker
  text: string
  timestamp: number
}

export type CoachingAdvice = {
  riskScore: number
  riskLevel: RiskLevel
  feedback: string
  whatToSay: string
  whatToDo: string
  nextSteps: string[]
  confidence: number
  updatedAt: number
}

export type LiveSessionSnapshot = {
  callId: string
  slug: string
  status: SessionStatus
  assistantMuted: boolean
  analyzing: boolean
  lastError: string | null
  updatedAt: number
  version: number
  advice: CoachingAdvice
  transcript: TranscriptChunk[]
}

export function getRiskLevel(score: number): RiskLevel {
  if (score >= 70) return 'high'
  if (score >= 40) return 'medium'
  return 'low'
}

export function createDefaultAdvice(): CoachingAdvice {
  const now = Date.now()

  return {
    riskScore: 20,
    riskLevel: 'low',
    feedback: 'Listening for risk signals. Stay calm and ask verifying questions.',
    whatToSay: 'Can you verify your company, case number, and callback number?',
    whatToDo: 'Do not share codes, account logins, or payment details.',
    nextSteps: [
      'Ask for their full name and department.',
      'Say you will call back using an official number.',
    ],
    confidence: 0.3,
    updatedAt: now,
  }
}

export function normalizeSessionStatus(rawStatus: string | undefined | null): SessionStatus {
  if (!rawStatus) return 'unknown'

  const normalized = rawStatus.toLowerCase()

  if (normalized.includes('initiat')) return 'queued'
  if (normalized.includes('queued')) return 'queued'
  if (normalized.includes('ring')) return 'ringing'
  if (normalized.includes('answer')) return 'in-progress'
  if (normalized.includes('in-progress') || normalized.includes('in progress') || normalized === 'active') {
    return 'in-progress'
  }
  if (normalized.includes('fail') || normalized.includes('error') || normalized.includes('busy')) {
    return 'failed'
  }
  if (normalized.includes('end') || normalized.includes('complete') || normalized.includes('cancel')) {
    return 'ended'
  }

  return 'unknown'
}

export function isTerminalStatus(status: SessionStatus): boolean {
  return status === 'ended' || status === 'failed'
}
