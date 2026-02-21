import { DetectiveBadge } from '@/components/detective-badge'
import { SetupForm } from '@/components/setup-form'
import { NoirFrame } from '@/components/noir-frame'

export default function SetupPage() {
  return (
    <NoirFrame>
      <DetectiveBadge />
      <p className="max-w-xs text-center font-mono text-sm leading-relaxed text-muted-foreground">
        Open a case. Get a second opinion before you act.
      </p>
      <div className="h-px w-16 bg-border" role="separator" />
      <SetupForm />
    </NoirFrame>
  )
}
