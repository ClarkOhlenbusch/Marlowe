'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { maskPhone } from '@/lib/phone'
import { Button } from '@/components/ui/button'
import { Phone, Loader2, CheckCircle2, AlertTriangle, RotateCcw } from 'lucide-react'
import Link from 'next/link'

type CallState = 'idle' | 'dialing' | 'success' | 'error'

export function CasePanel() {
  const router = useRouter()
  const [phoneNumber, setPhoneNumber] = useState<string | null>(null)
  const [callState, setCallState] = useState<CallState>('idle')
  const [caseNote, setCaseNote] = useState('')
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    const stored = localStorage.getItem('detective-phone')
    if (!stored) {
      router.push('/setup')
      return
    }
    setPhoneNumber(stored)
  }, [router])

  async function handleCall() {
    if (!phoneNumber) return

    setCallState('dialing')
    setCaseNote('Dialing...')

    try {
      const res = await fetch('/api/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber }),
      })

      const data = await res.json()

      if (data.ok) {
        setCallState('success')
        setCaseNote('Case opened. Calling you now.')
      } else {
        setCallState('error')
        setCaseNote(data.error || 'Something went wrong. Try again.')
      }
    } catch {
      setCallState('error')
      setCaseNote('Connection failed. Check your network and try again.')
    }
  }

  if (!mounted || !phoneNumber) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="flex w-full max-w-sm flex-col items-center gap-8">
      {/* Masked number display */}
      <div className="flex flex-col items-center gap-1">
        <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
          Agent on file
        </p>
        <p className="font-mono text-lg text-foreground">{maskPhone(phoneNumber)}</p>
      </div>

      {/* Primary action */}
      <div className="flex w-full flex-col items-center gap-3">
        {callState === 'idle' && (
          <>
            <Button
              onClick={handleCall}
              size="lg"
              className="h-14 w-full bg-primary font-mono text-sm font-semibold uppercase tracking-widest text-primary-foreground hover:bg-primary/90"
            >
              <Phone className="mr-2 h-5 w-5" />
              Open a Case
            </Button>
            <p className="text-center font-mono text-xs text-muted-foreground">
              By tapping, you consent to receive this call.
            </p>
          </>
        )}

        {callState === 'dialing' && (
          <div className="flex w-full flex-col items-center gap-3 rounded-lg border border-border bg-card px-6 py-8">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="font-mono text-sm uppercase tracking-widest text-muted-foreground">
              Dialing...
            </p>
          </div>
        )}

        {callState === 'success' && (
          <div className="flex w-full flex-col items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 px-6 py-8">
            <CheckCircle2 className="h-8 w-8 text-primary" />
            <p className="font-mono text-sm font-semibold uppercase tracking-widest text-primary">
              Case Opened
            </p>
            <p className="text-center font-mono text-sm text-foreground">
              Your detective is calling you now.
            </p>
            <Button
              onClick={() => {
                setCallState('idle')
                setCaseNote('')
              }}
              variant="outline"
              size="sm"
              className="mt-2 font-mono text-xs uppercase tracking-widest"
            >
              New Case
            </Button>
          </div>
        )}

        {callState === 'error' && (
          <div className="flex w-full flex-col items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-6 py-8">
            <AlertTriangle className="h-8 w-8 text-destructive" />
            <p className="font-mono text-sm font-semibold uppercase tracking-widest text-destructive">
              Case Blocked
            </p>
            <p className="text-center font-mono text-sm text-foreground">
              {caseNote}
            </p>
            <Button
              onClick={handleCall}
              variant="outline"
              size="sm"
              className="mt-2 font-mono text-xs uppercase tracking-widest"
            >
              <RotateCcw className="mr-2 h-3 w-3" />
              Retry
            </Button>
          </div>
        )}
      </div>

      {/* Case Notes */}
      {caseNote && callState !== 'dialing' && (
        <div className="w-full rounded-lg border border-border bg-card px-4 py-3">
          <p className="mb-1 font-mono text-xs uppercase tracking-widest text-muted-foreground">
            Case Notes
          </p>
          <p className="font-mono text-sm text-foreground">{caseNote}</p>
        </div>
      )}

      {/* Change number link */}
      <Link
        href="/setup"
        className="font-mono text-xs uppercase tracking-widest text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
      >
        Change number
      </Link>
    </div>
  )
}
