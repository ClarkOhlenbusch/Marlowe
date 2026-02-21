import Image from 'next/image'

export function DetectiveBadge() {
  return (
    <div className="flex flex-col items-center gap-4">
      <Image
        src="/logo.png"
        alt="The Scam Detective Hotline logo"
        width={96}
        height={96}
        className="h-24 w-24 rounded-2xl"
        priority
      />
      <h1 className="text-center font-serif text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
        The Scam Detective Hotline
      </h1>
    </div>
  )
}
