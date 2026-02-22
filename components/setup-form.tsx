'use client'

import { useId, useState } from 'react'
import { useRouter } from 'next/navigation'
import { normalizePhone } from '@/lib/phone'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Loader2 } from 'lucide-react'
import { BASE_TEXT_SIZE, MIN_TAP_TARGET, PRIMARY_TAP_TARGET, SECONDARY_TEXT_SIZE } from '@/lib/a11y'

export function SetupForm({ slug }: { slug: string }) {
  const router = useRouter()
  const hintId = useId()
  const errorId = useId()
  const statusId = useId()

  const [phone, setPhone] = useState('')
  const [error, setError] = useState('')
  const [statusMessage, setStatusMessage] = useState('')
  const [saving, setSaving] = useState(false)

  const describedBy = error ? `${hintId} ${errorId}` : hintId

  async function handleSave() {
    setError('')
    setStatusMessage('')
    const result = normalizePhone(phone)

    if (!result.ok) {
      setError(result.error)
      setStatusMessage('Please fix the phone number and try again.')
      return
    }

    setSaving(true)
    setStatusMessage('Saving your phone number.')

    try {
      const res = await fetch('/api/tenant/phone', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, phoneNumber: result.number }),
      })

      const data = await res.json()

      if (!data.ok) {
        setError(data.error || 'Failed to save. Please try again.')
        setStatusMessage('Could not save your phone number.')
        setSaving(false)
        return
      }

      setStatusMessage('Phone number saved. Opening your case.')
      router.push(`/t/${slug}`)
    } catch {
      setError('Connection failed. Check your network and try again.')
      setStatusMessage('Connection failed while saving your phone number.')
      setSaving(false)
    }
  }

  return (
    <form
      aria-busy={saving}
      onSubmit={(e) => {
        e.preventDefault()
        void handleSave()
      }}
      className="flex w-full max-w-sm flex-col gap-6"
    >
      <p id={statusId} className="sr-only" role="status" aria-live="polite">
        {saving ? 'Saving your phone number.' : statusMessage}
      </p>

      <div className="flex flex-col gap-3">
        <Label htmlFor="phone" className="font-mono text-base font-semibold tracking-wide text-foreground">
          Your protected number
        </Label>
        <Input
          id="phone"
          type="tel"
          autoComplete="tel"
          inputMode="tel"
          enterKeyHint="done"
          placeholder="4155552671 or +14155552671"
          value={phone}
          aria-describedby={describedBy}
          aria-invalid={Boolean(error)}
          onChange={(e) => {
            setPhone(e.target.value)
            if (error) setError('')
          }}
          style={{ minHeight: MIN_TAP_TARGET, fontSize: BASE_TEXT_SIZE }}
          className="border-border bg-secondary font-sans text-foreground placeholder:text-muted-foreground focus-visible:ring-primary"
        />
        <p id={hintId} className="font-sans text-base leading-relaxed text-muted-foreground">
          This is the number we call to start silent monitoring. You can enter 4155552671, 14155552671, or +14155552671.
        </p>
      </div>

      {error && (
        <div
          id={errorId}
          role="alert"
          aria-live="assertive"
          className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3"
        >
          <p className="font-sans text-base text-destructive-foreground">{error}</p>
        </div>
      )}

      <Button
        type="submit"
        size="lg"
        disabled={saving}
        style={{ minHeight: PRIMARY_TAP_TARGET, fontSize: SECONDARY_TEXT_SIZE }}
        className="w-full bg-primary font-mono font-semibold tracking-wide text-primary-foreground hover:bg-primary/90"
      >
        {saving ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Saving...
          </>
        ) : (
          'Save Number'
        )}
      </Button>
    </form>
  )
}
