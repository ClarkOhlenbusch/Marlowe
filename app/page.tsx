import { DetectiveBadge } from '@/components/detective-badge'
import { CasePanel } from '@/components/case-panel'
import { NoirFrame } from '@/components/noir-frame'

export default function HomePage() {
  return (
    <NoirFrame>
      <DetectiveBadge />
      <div className="h-px w-16 bg-border" role="separator" />
      <CasePanel />
    </NoirFrame>
  )
}
