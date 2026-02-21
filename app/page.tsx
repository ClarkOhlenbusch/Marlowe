import { DetectiveBadge } from '@/components/detective-badge'
import { NoirFrame } from '@/components/noir-frame'

export default function HomePage() {
  return (
    <NoirFrame>
      <DetectiveBadge />
      <p className="max-w-xs text-center font-mono text-sm leading-relaxed text-muted-foreground">
        Open a case. Get a second opinion before you act.
      </p>
      <div className="h-px w-16 bg-border" role="separator" />
      <p className="text-center font-mono text-xs leading-relaxed text-muted-foreground">
        Visit your tenant URL to get started.
      </p>
      <p className="font-mono text-xs text-muted-foreground/60">
        {'Example: /t/your-org-slug'}
      </p>
    </NoirFrame>
  )
}
