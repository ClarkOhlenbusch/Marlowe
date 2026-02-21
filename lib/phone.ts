/**
 * Normalize a phone number to E.164 format.
 * - Strips spaces, dashes, parentheses, dots
 * - If exactly 10 digits with no leading +, assume US (+1)
 * - Otherwise, must start with + and have 10-15 digits total
 */
export function normalizePhone(raw: string): { ok: true; number: string } | { ok: false; error: string } {
  const stripped = raw.replace(/[\s\-().]/g, '')

  // If no + prefix and exactly 10 digits, assume US
  if (/^\d{10}$/.test(stripped)) {
    return { ok: true, number: `+1${stripped}` }
  }

  // Must start with + and have 10-15 digits
  if (/^\+\d{10,15}$/.test(stripped)) {
    return { ok: true, number: stripped }
  }

  return {
    ok: false,
    error: 'Enter a valid phone number. Use +countrycode format (e.g. +14155552671) or 10 digits for US numbers.',
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
