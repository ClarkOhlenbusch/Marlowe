'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { normalizePhone } from '@/lib/phone'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Loader2 } from 'lucide-react'

export function SetupForm({ slug }: { slug: string }) {
  const router = useRouter()
  const [phone, setPhone] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    setError('')
    const result = normalizePhone(phone)

    if (!result.ok) {
      setError(result.error)
      return
    }

    setSaving(true)

    try {
      const res = await fetch('/api/tenant/phone', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, phoneNumber: result.number }),
      })

      const data = await res.json()

      if (!data.ok) {
        setError(data.error || 'Failed to save. Please try again.')
        setSaving(false)
        return
      }

      router.push(`/t/${slug}`)
    } catch {
      setError('Connection failed. Check your network and try again.')
      setSaving(false)
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        handleSave()
      }}
      className="flex w-full max-w-sm flex-col gap-5"
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor="phone" className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
          Your Phone Number
        </Label>
        <Input
          id="phone"
          type="tel"
          autoComplete="tel"
          placeholder="+14155552671"
          value={phone}
          onChange={(e) => {
            setPhone(e.target.value)
            if (error) setError('')
          }}
          className="h-12 border-border bg-secondary font-mono text-base text-foreground placeholder:text-muted-foreground focus-visible:ring-primary"
        />
        <p className="font-mono text-xs text-muted-foreground">
          {'Use +countrycode format if possible. Example: +14155552671'}
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3">
          <p className="font-mono text-sm text-destructive-foreground">{error}</p>
        </div>
      )}

      <Button
        type="submit"
        size="lg"
        disabled={saving}
        className="h-12 bg-primary font-mono text-sm font-semibold uppercase tracking-widest text-primary-foreground hover:bg-primary/90"
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
