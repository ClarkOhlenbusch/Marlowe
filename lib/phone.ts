/**
 * Normalize a phone number to E.164 format.
 * - Accepts common formatting characters, and optional extension suffixes
 * - If exactly 10 digits with no leading +, assume US (+1)
 * - If exactly 11 digits starting with 1, normalize to +1XXXXXXXXXX
 * - If prefixed with 00 and 10-15 digits, normalize to + format
 * - Otherwise, must be + followed by 10-15 digits
 */
export function normalizePhone(raw: string): { ok: true; number: string } | { ok: false; error: string } {
  const withoutExtension = raw
    .trim()
    .replace(/\s*(?:ext\.?|x|extension)\s*\d+\s*$/i, '')

  // Keep only digits and + so user formatting like "(+1) 415-555-2671" still works.
  const stripped = withoutExtension.replace(/[^\d+]/g, '')
  const plusCount = (stripped.match(/\+/g) || []).length

  if (!stripped || plusCount > 1 || (plusCount === 1 && !stripped.startsWith('+'))) {
    return {
      ok: false,
      error:
        'Enter a valid phone number. Use 10 US digits, 11 digits starting with 1, or +country format (example: +14155552671).',
    }
  }

  // If no + prefix and exactly 10 digits, assume US
  if (/^\d{10}$/.test(stripped)) {
    return { ok: true, number: `+1${stripped}` }
  }

  // If 11 digits with leading 1, normalize to US E.164.
  if (/^1\d{10}$/.test(stripped)) {
    return { ok: true, number: `+${stripped}` }
  }

  // Convert 00-prefixed international format to +.
  if (/^00\d{10,15}$/.test(stripped)) {
    return { ok: true, number: `+${stripped.slice(2)}` }
  }

  // Must start with + and have 10-15 digits
  if (/^\+\d{10,15}$/.test(stripped)) {
    return { ok: true, number: stripped }
  }

  return {
    ok: false,
    error:
      'Enter a valid phone number. Use 10 US digits, 11 digits starting with 1, or +country format (example: +14155552671).',
  }
}

/**
 * Validate E.164 format strictly
 */
export function isValidE164(phone: string): boolean {
  return /^\+\d{10,15}$/.test(phone)
}

/**
 * Mask phone number for display: +1 *** *** 2671
 */
export function maskPhone(phone: string): string {
  if (phone.length < 5) return phone
  const countryCode = phone.slice(0, phone.length - 10) || phone.slice(0, 2)
  const lastFour = phone.slice(-4)
  return `${countryCode} *** *** ${lastFour}`
}
