export function NoirFrame({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative flex min-h-dvh flex-col items-center justify-center bg-background px-6 py-12">
      {/* Subtle top accent line */}
      <div className="absolute inset-x-0 top-0 h-px bg-primary/20" aria-hidden="true" />

      {/* Content */}
      <div className="flex w-full max-w-md flex-col items-center gap-8">
        {children}
      </div>

      {/* Footer */}
      <footer className="absolute inset-x-0 bottom-0 flex justify-center py-6">
        <p className="font-mono text-xs uppercase tracking-[0.25em] text-muted-foreground/50">
          Scam Detective Hotline
        </p>
      </footer>
    </main>
  )
}
