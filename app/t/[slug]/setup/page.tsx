import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { DetectiveBadge } from '@/components/detective-badge'
import { SetupForm } from '@/components/setup-form'
import { NoirFrame } from '@/components/noir-frame'

export default async function TenantSetupPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const supabase = await createClient()

  const { data: tenant } = await supabase
    .from('tenants')
    .select('id, slug, name')
    .eq('slug', slug)
    .single()

  if (!tenant) {
    notFound()
  }

  return (
    <NoirFrame>
      <DetectiveBadge />
      {tenant.name && (
        <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
          {tenant.name}
        </p>
      )}
      <p className="max-w-xs text-center font-mono text-sm leading-relaxed text-muted-foreground">
        Open a case. Get a second opinion before you act.
      </p>
      <div className="h-px w-16 bg-border" role="separator" />
      <SetupForm slug={slug} />
    </NoirFrame>
  )
}
