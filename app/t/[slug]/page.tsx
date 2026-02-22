import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { BRAND_NAME, resolveTenantDisplayName } from '@/lib/brand'
import { CasePanel } from '@/components/case-panel'

export default async function TenantHomePage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const supabase = await createClient()

  console.log('[v0] Tenant page loading for slug:', slug)

  const { data: tenant, error: tenantError } = await supabase
    .from('tenants')
    .select('id, slug, name, phone_number')
    .eq('slug', slug)
    .single()

  console.log('[v0] Tenant query result:', { tenant, error: tenantError })

  if (!tenant) {
    notFound()
  }

  // If no phone number saved yet, redirect to setup
  if (!tenant.phone_number) {
    const { redirect } = await import('next/navigation')
    redirect(`/t/${slug}/setup`)
  }

  const displayTenantName = resolveTenantDisplayName(tenant.name)

  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="relative min-h-dvh bg-background px-4 py-5 sm:px-6 sm:py-8"
    >
      <div className="absolute inset-x-0 top-0 h-px bg-primary/20" aria-hidden="true" />

      <div className="mx-auto flex w-full max-w-md justify-center pb-14">
        <CasePanel
          slug={slug}
          maskedPhone={maskForDisplay(tenant.phone_number)}
          tenantName={displayTenantName}
        />
      </div>

      <footer className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center py-6">
        <p className="font-mono text-sm tracking-wide text-muted-foreground/70">
          {BRAND_NAME}
        </p>
      </footer>
    </main>
  )
}

function maskForDisplay(phone: string): string {
  if (phone.length <= 4) return phone
  return phone.slice(0, -4).replace(/./g, '*') + phone.slice(-4)
}
