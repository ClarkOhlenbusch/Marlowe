import { NextRequest, NextResponse } from 'next/server'
import { isValidE164 } from '@/lib/phone'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { phoneNumber } = body

    if (!phoneNumber || typeof phoneNumber !== 'string') {
      return NextResponse.json(
        { ok: false, error: 'Phone number is required.' },
        { status: 400 }
      )
    }

    if (!isValidE164(phoneNumber)) {
      return NextResponse.json(
        { ok: false, error: 'Invalid phone number format. Use E.164 format (e.g. +14155552671).' },
        { status: 400 }
      )
    }

    const vapiKey = process.env.VAPI_PRIVATE_KEY
    const assistantId = process.env.VAPI_ASSISTANT_ID
    const phoneNumberId = process.env.VAPI_PHONE_NUMBER_ID

    if (!vapiKey || !assistantId || !phoneNumberId) {
      return NextResponse.json(
        { ok: false, error: 'Server configuration error. Contact support.' },
        { status: 500 }
      )
    }

    const vapiResponse = await fetch('https://api.vapi.ai/call', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${vapiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        assistantId,
        phoneNumberId,
        customer: { number: phoneNumber },
      }),
    })

    if (!vapiResponse.ok) {
      const errorData = await vapiResponse.json().catch(() => null)
      const errorMessage =
        errorData?.message || errorData?.error || `Vapi returned status ${vapiResponse.status}`
      return NextResponse.json(
        { ok: false, error: errorMessage },
        { status: vapiResponse.status }
      )
    }

    const data = await vapiResponse.json()

    return NextResponse.json({
      ok: true,
      callId: data.id,
      status: data.status || 'queued',
    })
  } catch {
    return NextResponse.json(
      { ok: false, error: 'An unexpected error occurred. Please try again.' },
      { status: 500 }
    )
  }
}
