import { NextRequest, NextResponse } from 'next/server'
import { isValidE164 } from '@/lib/phone'
import { getClientIp, takeCooldown, takeRateLimit } from '@/lib/rate-limit'
import { createAdminClient } from '@/lib/supabase/admin'
import { upsertLiveCallSession } from '@/lib/live-store'
import { createOutboundTwilioCall, getTwilioConfig } from '@/lib/twilio-api'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { slug } = body

    if (!slug || typeof slug !== 'string') {
      return NextResponse.json(
        { ok: false, error: 'Tenant slug is required.' },
        { status: 400 }
      )
    }

    const ip = getClientIp(request)
    if (!takeRateLimit(`call:ip:${ip}`, 5, 60_000)) {
      return NextResponse.json(
        { ok: false, error: 'Too many requests. Please wait a minute and try again.' },
        { status: 429 }
      )
    }

    const remainingSeconds = takeCooldown(`call:slug:${slug}`, 30_000)
    if (remainingSeconds > 0) {
      return NextResponse.json(
        { ok: false, error: `A call was just placed. Try again in about ${remainingSeconds}s.` },
        { status: 429 }
      )
    }

    // Look up phone number from the tenant record
    const supabase = createAdminClient()
    const { data: tenant, error: dbError } = await supabase
      .from('tenants')
      .select('phone_number')
      .eq('slug', slug)
      .single()

    if (dbError || !tenant) {
      return NextResponse.json(
        { ok: false, error: 'Tenant not found.' },
        { status: 404 }
      )
    }

    const phoneNumber = tenant.phone_number

    if (!phoneNumber || !isValidE164(phoneNumber)) {
      return NextResponse.json(
        { ok: false, error: 'No valid phone number on file. Please set one up first.' },
        { status: 400 }
      )
    }

    const twilioConfig = getTwilioConfig()

    if (!twilioConfig || !isValidE164(twilioConfig.phoneNumber)) {
      return NextResponse.json(
        { ok: false, error: 'Server configuration error. Contact support.' },
        { status: 500 }
      )
    }

    const twimlUrl = new URL('/api/twilio/twiml', request.url)
    twimlUrl.searchParams.set('slug', slug)

    const webhookUrl = new URL('/api/twilio/webhook', request.url)
    webhookUrl.searchParams.set('slug', slug)

    let callId = ''
    let callStatus = 'queued'

    try {
      const createdCall = await createOutboundTwilioCall({
        to: phoneNumber,
        twimlUrl: twimlUrl.toString(),
        statusCallbackUrl: webhookUrl.toString(),
      })

      callId = createdCall.sid
      callStatus = createdCall.status
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : 'Failed to place monitor call through Twilio.'
      return NextResponse.json(
        { ok: false, error: message },
        { status: 502 }
      )
    }

    await upsertLiveCallSession({
      callSid: callId,
      slug,
      status: callStatus,
    })

    return NextResponse.json({
      ok: true,
      callId,
      status: callStatus,
    })
  } catch {
    return NextResponse.json(
      { ok: false, error: 'An unexpected error occurred. Please try again.' },
      { status: 500 }
    )
  }
}
