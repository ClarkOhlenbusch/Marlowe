import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { DetectiveBadge } from '@/components/detective-badge'
import { CasePanel } from '@/components/case-panel'
import { NoirFrame } from '@/components/noir-frame'

export default async function TenantHomePage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const supabase = await createClient()

  const { data: tenant } = await supabase
    .from('tenants')
    .select('id, slug, name, phone_number')
    .eq('slug', slug)
    .single()

  if (!tenant) {
    notFound()
  }

  // If no phone number saved yet, redirect to setup
  if (!tenant.phone_number) {
    const { redirect } = await import('next/navigation')
    redirect(`/t/${slug}/setup`)
  }

  return (
    <NoirFrame>
      <DetectiveBadge />
      {tenant.name && (
        <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
          {tenant.name}
        </p>
      )}
      <div className="h-px w-16 bg-border" role="separator" />
      <CasePanel slug={slug} maskedPhone={maskForDisplay(tenant.phone_number)} />
    </NoirFrame>
  )
}

function maskForDisplay(phone: string): string {
  if (phone.length <= 4) return phone
  return phone.slice(0, -4).replace(/./g, '*') + phone.slice(-4)
}
