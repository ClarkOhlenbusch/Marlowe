'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { normalizePhone } from '@/lib/phone'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function SetupForm() {
  const router = useRouter()
  const [phone, setPhone] = useState('')
  const [error, setError] = useState('')

  function handleSave() {
    setError('')
    const result = normalizePhone(phone)

    if (!result.ok) {
      setError(result.error)
      return
    }

    localStorage.setItem('detective-phone', result.number)
    router.push('/')
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
        className="h-12 bg-primary font-mono text-sm font-semibold uppercase tracking-widest text-primary-foreground hover:bg-primary/90"
      >
        Save Number
      </Button>
    </form>
  )
}
