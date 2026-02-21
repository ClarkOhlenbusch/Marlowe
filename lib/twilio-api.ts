type TwilioConfig = {
  accountSid: string
  authToken: string
  phoneNumber: string
}

type TwilioCallCreateResult = {
  sid: string
  status: string
}

type JsonRecord = Record<string, unknown>

function readTwilioEnv(): TwilioConfig | null {
  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim()
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim()
  const phoneNumber = process.env.TWILIO_PHONE_NUMBER?.trim()

  if (!accountSid || !authToken || !phoneNumber) {
    return null
  }

  return {
    accountSid,
    authToken,
    phoneNumber,
  }
}

function createBasicAuthHeader(username: string, password: string): string {
  const token = Buffer.from(`${username}:${password}`).toString('base64')
  return `Basic ${token}`
}

function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as JsonRecord
}

function readString(record: JsonRecord | null, key: string): string | null {
  if (!record) return null
  const value = record[key]
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

export function getTwilioConfig(): TwilioConfig | null {
  return readTwilioEnv()
}

export async function createOutboundTwilioCall(params: {
  to: string
  twimlUrl: string
  statusCallbackUrl: string
}): Promise<TwilioCallCreateResult> {
  const config = readTwilioEnv()

  if (!config) {
    throw new Error('Twilio env vars are missing.')
  }

  const body = new URLSearchParams()
  body.set('To', params.to)
  body.set('From', config.phoneNumber)
  body.set('Url', params.twimlUrl)
  body.set('Method', 'POST')
  body.set('StatusCallback', params.statusCallbackUrl)
  body.set('StatusCallbackMethod', 'POST')
  body.append('StatusCallbackEvent', 'initiated')
  body.append('StatusCallbackEvent', 'ringing')
  body.append('StatusCallbackEvent', 'answered')
  body.append('StatusCallbackEvent', 'completed')

  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(config.accountSid)}/Calls.json`,
    {
      method: 'POST',
      headers: {
        Authorization: createBasicAuthHeader(config.accountSid, config.authToken),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      signal: AbortSignal.timeout(15_000),
      body,
    },
  )

  const payload = await response.json().catch(() => null)
  const record = asRecord(payload)

  if (!response.ok) {
    const message =
      readString(record, 'message') ||
      readString(record, 'error_message') ||
      `Twilio returned status ${response.status}`
    throw new Error(message)
  }

  const sid = readString(record, 'sid')
  const status = readString(record, 'status') ?? 'queued'

  if (!sid) {
    throw new Error('Twilio call created but no sid was returned.')
  }

  return {
    sid,
    status,
  }
}
