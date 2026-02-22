export type MergeTranscriptTextOptions = {
  isFinal?: boolean
}

const FINAL_REPLACE_MIN_WORDS = 5

function normalizeToken(value: string): string {
  const lowered = value.toLowerCase()
  const stripped = lowered.replace(/^[^a-z0-9']+|[^a-z0-9']+$/g, '')
  return stripped || lowered
}

function findWordOverlap(previousWords: string[], nextWords: string[]): number {
  const maxOverlap = Math.min(previousWords.length, nextWords.length)

  for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
    let matched = true

    for (let index = 0; index < overlap; index += 1) {
      const previousToken = normalizeToken(previousWords[previousWords.length - overlap + index] ?? '')
      const nextToken = normalizeToken(nextWords[index] ?? '')

      if (!previousToken || !nextToken || previousToken !== nextToken) {
        matched = false
        break
      }
    }

    if (matched) {
      return overlap
    }
  }

  return 0
}

function collapseDuplicateWords(words: string[]): string[] {
  const deduped: string[] = []
  let previousToken = ''

  for (const word of words) {
    const token = normalizeToken(word)
    if (token && token === previousToken) {
      continue
    }

    deduped.push(word)
    previousToken = token
  }

  return deduped
}

function shouldReplaceWithFinal(previousWords: string[], nextWords: string[]): boolean {
  if (nextWords.length < FINAL_REPLACE_MIN_WORDS) {
    return false
  }

  return nextWords.length >= previousWords.length
}

export function normalizeTranscriptText(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

export function mergeIncrementalTranscriptText(
  previousText: string,
  nextText: string,
  options: MergeTranscriptTextOptions = {},
): string {
  const previous = normalizeTranscriptText(previousText)
  const next = normalizeTranscriptText(nextText)

  if (!previous) return next
  if (!next) return previous

  const previousLower = previous.toLowerCase()
  const nextLower = next.toLowerCase()

  if (previousLower === nextLower) {
    return previous
  }

  if (nextLower.startsWith(previousLower)) {
    return next
  }

  if (previousLower.startsWith(nextLower)) {
    return previous
  }

  const previousWords = previous.split(' ')
  const nextWords = next.split(' ')
  const overlap = findWordOverlap(previousWords, nextWords)

  if (overlap > 0) {
    return collapseDuplicateWords([...previousWords, ...nextWords.slice(overlap)]).join(' ')
  }

  if (options.isFinal && shouldReplaceWithFinal(previousWords, nextWords)) {
    return next
  }

  return collapseDuplicateWords([...previousWords, ...nextWords]).join(' ')
}
