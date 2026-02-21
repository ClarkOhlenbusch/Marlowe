import { NextRequest, NextResponse } from 'next/server'
import { getLiveSessionSnapshot } from '@/lib/live-store'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const callId = request.nextUrl.searchParams.get('callId')
  const slug = request.nextUrl.searchParams.get('slug')

  if (!callId || !slug) {
    return NextResponse.json(
      { ok: false, error: 'callId and slug are required.' },
      { status: 400 },
    )
  }

  try {
    const session = await getLiveSessionSnapshot(callId, slug, 8)

    if (!session) {
      return NextResponse.json(
        { ok: false, error: 'Live call session not found for this case.' },
        {
          status: 404,
          headers: {
            'Cache-Control': 'no-store',
          },
        },
      )
    }

    return NextResponse.json(
      {
        ok: true,
        ...session,
      },
      {
        headers: {
          'Cache-Control': 'no-store',
        },
      },
    )
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Failed to load live session.' },
      {
        status: 500,
        headers: {
          'Cache-Control': 'no-store',
        },
      },
    )
  }
}
