import { Phone } from 'lucide-react'

export function DetectiveBadge() {
  return (
    <div className="flex flex-col items-center gap-4">
      <div className="relative">
        <div className="flex h-20 w-20 items-center justify-center rounded-full border-2 border-primary/30 bg-card">
          <Phone className="h-8 w-8 text-primary" />
        </div>
        <div className="absolute -bottom-1 -right-1 h-4 w-4 rounded-full border border-card bg-primary" />
      </div>
      <h1 className="text-center font-serif text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
        The Scam Detective Hotline
      </h1>
    </div>
  )
}
