import { NextRequest, NextResponse } from 'next/server'
import { isValidE164 } from '@/lib/phone'
import { createAdminClient } from '@/lib/supabase/admin'

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const { slug, phoneNumber } = body

    if (!slug || typeof slug !== 'string') {
      return NextResponse.json(
        { ok: false, error: 'Tenant slug is required.' },
        { status: 400 }
      )
    }

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

    const supabase = createAdminClient()

    const { error } = await supabase
      .from('tenants')
      .update({ phone_number: phoneNumber, updated_at: new Date().toISOString() })
      .eq('slug', slug)

    if (error) {
      return NextResponse.json(
        { ok: false, error: 'Failed to save phone number.' },
        { status: 500 }
      )
    }

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json(
      { ok: false, error: 'An unexpected error occurred.' },
      { status: 500 }
    )
  }
}
