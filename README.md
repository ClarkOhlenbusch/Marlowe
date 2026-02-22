# Marlowe 🕵🏻
> **Name inspiration:** *Marlowe* (1969), the neo-noir detective film starring James Garner.

A hackathon project that helps people pause before they get scammed. Users submit their phone number, tap **Start Silent Monitor**, and receive a callback that streams live transcript to an on-screen scam coach.

## Project Goal
We chose this project because AI-enabled scams amplify already widespread, underreported extortion and impersonation fraud: the FBI’s IC3 reported 39,416 extortion victims with about $54.3M in losses in 2022, and 14,190 government impersonation scam victims with over $394M in losses in 2023, with older adults disproportionately harmed ([FBI ICR](https://www.ic3.gov/AnnualReport/Reports/2022_ic3report.pdf), [FBI](https://www.fbi.gov/contact-us/field-offices/portland/news/fbi-warns-public-to-beware-of-scammers-impersonating-fbi-agents-and-other-government-officials)). Our goal was to build a practical tool that helps people pause and verify during high-pressure scam situations.

This weekend, we built a working prototype of **Marlowe**: users can enter their phone number, tap **Open a Case**, and receive an instant AI callback for a **live** second opinion. We also developed and tested the core user flow and voice/scam test scenarios.

## Team
- [Clark Ohlenbusch](https://www.linkedin.com/in/clark-ohlenbusch-bb8b60253/) - Lead Developer (Implemented the hotline backend and Twilio call orchestration to deliver rapid scam second-opinion callbacks)
- [Michael Marrero](https://www.linkedin.com/in/michael-marreroii/) - Product Development / Engineer (Built the deepfake simulation pipeline for testing and led product positioning/business planning for real-world adoption)
- [Julie Hohenberg](https://www.linkedin.com/in/juliehohenberg/) - Data Science & Research (Created scam test cases and voice-validation inputs, and conducted market/user research focused on vulnerable-target scam scenarios)

## Hackathon Build Notes
This project was built with a hybrid workflow:
- Framework + initial skeleton generated with **Vercel v0**
- Extended and refined with **handwritten code**
- AI-assisted iteration using **Codex**, **Claude Code**, **Gemini CLI**, and **Kiro CLI**
- Deployed on **Vercel**
- **Supabase** powers tenant records, live call state, transcript persistence, and Realtime subscriptions
- **Twilio** powers outbound monitor calls plus live transcription/status callbacks
- **Groq** is used as an optional model layer on top of local heuristic scam scoring

## Tech Stack
- **Framework:** Next.js 16 (App Router), React 19, TypeScript
- **UI:** Tailwind CSS v4, Radix UI primitives, shadcn-style component architecture
- **Backend/API:** Next.js Route Handlers (`app/api/call/*`, `app/api/twilio/*`, `app/api/tenant/phone`)
- **Voice/Calling:** Twilio Programmable Voice (outbound calls + transcription webhooks)
- **Coaching Engine:** Local heuristic risk analysis with optional Groq Chat Completions enrichment
- **Data/Realtime:** Supabase Postgres + Supabase Realtime + `@supabase/ssr`
- **Infra:** Vercel deployment + Vercel Analytics

## Features
- Tenant-scoped case flow (`/start` provisions or resumes a tenant slug, then routes to `/t/{slug}`)
- Guided setup flow to capture and normalize a protected phone number
- Server-side outbound call initiation with rate limiting and cooldown protection
- Twilio signature-validated webhook ingestion (handles form-encoded and JSON payloads)
- Live transcript + coaching updates via Supabase Realtime with polling fallback
- Real-time scam risk scoring and action-first coaching with model-rate-limit backoff handling

## Getting Started
### Prerequisites
- Node.js 20+
- `pnpm`
- A Supabase project
- A Twilio number with voice enabled

### Install and run
```bash
pnpm install
pnpm dev
```
Open `http://localhost:3000` (the app redirects `/` to `/start`).

### Database setup
Run SQL migrations in your Supabase/Postgres database (in order):

```bash
psql "$POSTGRES_URL_NON_POOLING" -f scripts/001_create_tenants.sql
psql "$POSTGRES_URL_NON_POOLING" -f scripts/003_live_call_tables.sql
psql "$POSTGRES_URL_NON_POOLING" -f scripts/004_enable_realtime_live_tables.sql
```

Optional demo seed:

```bash
psql "$POSTGRES_URL_NON_POOLING" -f scripts/002_seed_demo_tenant.sql
```

`scripts/004_enable_realtime_live_tables.sql` enables Supabase Realtime publication plus demo read policies for `live_calls` and `live_transcript_chunks`.

### Production build
```bash
pnpm build
pnpm start
```

### Lint
```bash
pnpm lint
```

### Mock sanity flow
```bash
pnpm test:mock
```
`pnpm test:mock` expects the app running locally and exercises `/start`, `/api/tenant/phone`, `/api/twilio/webhook`, and `/api/call/live`.

## Environment Variables
Create `.env.local` with:

Required:

```bash
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
TWILIO_ACCOUNT_SID=...
TWILIO_AUTH_TOKEN=...
TWILIO_PHONE_NUMBER=...
```

Optional:

```bash
GROQ_API_KEY=...
GROQ_MODEL=meta-llama/llama-4-scout-17b-16e-instruct
GROQ_RPM_LIMIT=30
GROQ_MIN_INTERVAL_MS=2800
TWILIO_WEBHOOK_SKIP_SIGNATURE_VALIDATION=1
PUBLIC_BASE_URL=https://your-domain.com
# or APP_BASE_URL / NEXT_PUBLIC_APP_URL
TENANT_ADMIN_OVERRIDE_TOKEN=...
BASE_URL=http://127.0.0.1:3000
```

Notes:
- `GROQ_API_KEY` is optional. Without it, the app uses local heuristic advice only.
- Keep Twilio signature validation enabled in production (`TWILIO_WEBHOOK_SKIP_SIGNATURE_VALIDATION` unset or `0`).
- If `PUBLIC_BASE_URL`/`APP_BASE_URL`/`NEXT_PUBLIC_APP_URL` are unset, webhook URLs fall back to forwarded host headers (or Vercel production host).

## Project Structure
```text
app/                          # routes, layouts, API handlers
app/start/route.ts            # provisions/reuses tenant slug and redirects to /t/{slug}
app/t/[slug]/                 # tenant case page + setup page
app/api/call/                 # call start + live session snapshot
app/api/twilio/               # TwiML + Twilio webhook ingest/validation
app/api/tenant/phone/         # protected number setup endpoint
components/                   # app and UI components
lib/live-*.ts                 # live status, transcript, and coaching logic
lib/supabase/                 # server/admin/browser Supabase clients
lib/twilio-*.ts               # Twilio API + webhook parsing/verification
scripts/                      # SQL migrations + mock live-flow test
```

## Deployment
This project is configured for Vercel deployment. Import the repo into Vercel, set the environment variables above, run the SQL migrations in Supabase, and verify Twilio can reach your deployed `/api/twilio/webhook` endpoint.

## Reflection
Our main challenge was designing something people could realistically use during a high-stress scam call, so we focused on a simple, fast user flow. We also attended Lucas Maley’s PM workshop, which helped us think more clearly about product design and feature prioritization.

## License
This project was created as a hackathon prototype and is provided for demonstration purposes only.

No license is granted at this time. You may not use, copy, modify, or distribute this code without permission from the authors.

A production license may be added in the future.
