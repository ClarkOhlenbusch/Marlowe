<p align="center">
  <img src="public/logo.png" alt="Marlowe logo" width="120" />
</p>

<h1 align="center">Marlowe</h1>

<p align="center">
  <strong>Your AI scam detective — a real-time coaching hotline that listens to your live phone call and tells you when something smells wrong.</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Next.js-16-black?logo=next.js" alt="Next.js 16" />
  <img src="https://img.shields.io/badge/React-19-61DAFB?logo=react" alt="React 19" />
  <img src="https://img.shields.io/badge/Twilio-Live%20Transcription-F22F46?logo=twilio" alt="Twilio" />
  <img src="https://img.shields.io/badge/Groq-LLM%20Coaching-orange" alt="Groq" />
  <img src="https://img.shields.io/badge/Supabase-Realtime-3ECF8E?logo=supabase" alt="Supabase" />
</p>

---
> **Name inspiration:** *Marlowe* (1969), a neo-noir detective film starring James Garner.

<p>
  <img src="public/marlowe_movie_1969.jpg" alt="Marlowe (1969) poster inspiration" width="120" />
</p>

---

## Why This Is More Than a Wrapper

Most "AI scam detector" demos paste text into a chatbot and call it a day. Marlowe is fundamentally different — we built a **live telephony feedback loop** that works on real phone calls, including iPhone calls that are normally completely gated from third-party access.

Here's what we actually pulled off this weekend:

1. **Live iPhone call transcription** — We orchestrate a Twilio-powered silent monitor call that bridges into the user's active conversation. Twilio's `<Transcription>` streams both sides of the call (`track="both_tracks"`) as partial and final transcript events via webhooks — giving us real-time access to audio that iOS normally locks down entirely.

2. **Near-real-time coaching pipeline** — Every transcript chunk hits our webhook, gets persisted to Supabase, and triggers a dual-layer analysis engine:
   - **Heuristic scoring** fires instantly using pattern-matched risk signals (gift cards, wire transfers, urgency language, credential harvesting, etc.)
   - **LLM analysis** via Groq runs on a rate-limit-aware schedule with exponential backoff, stabilized advice diffing, and score-movement dampening to avoid whiplash

3. **Live push to the client** — Supabase Realtime streams coaching updates, risk scores, and transcript chunks to the user's screen as the call happens. No polling. No delay.

4. **Self-healing call loop** — The TwiML uses a `<Pause>` + `<Redirect>` pattern to keep the transcription session alive indefinitely without dropping the call, automatically re-upping the connection every 60 seconds.

This isn't a chatbot. It's a **real-time telephony intelligence system** built in a weekend.

---

## Production-Grade Completeness

Despite being a hackathon build, Marlowe ships with real production hardening:

- **End-to-end integration testing** — A full mock flow (`pnpm test:mock`) provisions a tenant, saves a phone number, fires simulated Twilio webhook events (both form-encoded and JSON), waits for the coaching pipeline to produce a risk score ≥ 40, verifies call-ended status propagation, and asserts the entire loop. It even computes valid Twilio HMAC-SHA1 signatures so the webhook auth path is exercised.
- **Twilio webhook signature validation** — HMAC-SHA1 verification on every inbound webhook, with URL candidate generation to handle proxy/forwarding edge cases and constant-time comparison to prevent timing attacks.
- **Rate limiting & cooldowns** — IP-based rate limiting on call initiation (5 calls/min) and phone setup (20/10min), plus per-tenant cooldowns (30s between calls) to prevent abuse.
- **LLM rate-limit resilience** — Exponential backoff with streak tracking on Groq 429s, automatic fallback to heuristic scoring during cooldown, and configurable RPM-derived intervals.
- **Row Level Security** — Supabase tables use RLS with explicit policies; server-side writes go through a service-role client that bypasses RLS.
- **Input validation everywhere** — E.164 phone normalization with US shorthand support, slug format validation, XML escaping in TwiML generation, and structured Zod schemas for LLM response parsing.
- **Database migrations** — Versioned SQL scripts for schema creation, Realtime publication setup, and demo tenant seeding.
- **Linting** — ESLint across the full codebase (`pnpm lint`).

---

## The Problem

AI-enabled scams are amplifying already widespread fraud:

- The FBI's IC3 reported **39,416 extortion victims** with ~$54.3M in losses in 2022 ([FBI IC3 Report](https://www.ic3.gov/AnnualReport/Reports/2022_ic3report.pdf))
- **14,190 government impersonation scam victims** with over $394M in losses in 2023 ([FBI](https://www.fbi.gov/contact-us/field-offices/portland/news/fbi-warns-public-to-beware-of-scammers-impersonating-fbi-agents-and-other-government-officials))
- Older adults are disproportionately harmed

Scammers use urgency, fear, and isolation to prevent victims from pausing to think. Marlowe gives people a **live second opinion** during the call itself — before they send money, share credentials, or comply with threats.

---

## How It Works

```
User enters phone number → Marlowe calls them back via Twilio
                                    ↓
              Twilio bridges a silent monitor + starts <Transcription>
                                    ↓
              Both-track transcript streams to /api/twilio/webhook
                                    ↓
              Heuristic risk scoring fires immediately
              Groq LLM coaching runs on a rate-limited schedule
                                    ↓
              Supabase Realtime pushes advice + transcript to the UI
                                    ↓
              User sees live risk score, coaching, and "what to say" prompts
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router), React 19, TypeScript |
| UI | Tailwind CSS v4, Radix UI, shadcn-style components |
| Voice/Calling | Twilio Programmable Voice (outbound calls + transcription webhooks) |
| Coaching Engine | Local heuristic risk analysis + Groq Chat Completions (llama-3.3-70b-versatile) |
| Realtime Data | Supabase Postgres + Supabase Realtime + `@supabase/ssr` |
| Deployment | Vercel + Vercel Analytics |

---

## Team

| Name | Role | Contribution |
|------|------|-------------|
| [Clark Ohlenbusch](https://www.linkedin.com/in/clark-ohlenbusch-bb8b60253/) | Lead Developer | Built the hotline backend, Twilio call orchestration, live transcription pipeline, and real-time coaching engine |
| [Michael Marrero](https://www.linkedin.com/in/michael-marreroii/) | Product Development / Engineer | Built the deepfake simulation pipeline for testing; led product positioning and business planning for real-world adoption |
| [Julie Hohenberg](https://www.linkedin.com/in/juliehohenberg/) | Data Science & Research | Created scam test cases and voice-validation inputs; conducted market/user research focused on vulnerable-target scam scenarios |

---

## Hackathon Build Notes

Built in a weekend with a hybrid workflow:

- **Vercel v0** — framework + initial skeleton
- **Handwritten code** — core telephony pipeline, webhook handling, coaching engine
- **AI-assisted iteration** — Codex, Claude Code, Gemini CLI, Kiro CLI
- **Supabase** — backend services, Realtime, Postgres
- **Twilio** — outbound calls + live transcription
- **Groq** — real-time LLM coaching on transcript chunks

---

## 🚀 Getting Started

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

### Environment Variables

Create `.env.local`:

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
TENANT_ADMIN_OVERRIDE_TOKEN=...
BASE_URL=http://127.0.0.1:3000
```

Notes:
- `GROQ_API_KEY` is optional. Without it, the app uses local heuristic advice only.
- Keep Twilio signature validation enabled in production (`TWILIO_WEBHOOK_SKIP_SIGNATURE_VALIDATION` unset or `0`).
- If `PUBLIC_BASE_URL`/`APP_BASE_URL`/`NEXT_PUBLIC_APP_URL` are unset, webhook URLs fall back to forwarded host headers.

---

## Project Structure

```
app/                          # Routes, layouts, API handlers
app/start/route.ts            # Provisions/reuses tenant slug → redirects to /t/{slug}
app/t/[slug]/                 # Tenant case page + setup page
app/api/call/                 # Call start + live session snapshot
app/api/twilio/twiml/         # TwiML generation (transcription + keep-alive loop)
app/api/twilio/webhook/       # Live transcript ingestion + coaching pipeline
app/api/tenant/phone/         # Protected number setup endpoint
components/                   # App and UI components
hooks/                        # Reusable React hooks
lib/live-*.ts                 # Live status, transcript, and coaching logic
lib/supabase/                 # Server/admin/browser Supabase clients
lib/twilio-*.ts               # Twilio API + webhook parsing/verification
scripts/                      # SQL migrations + mock live-flow test
public/                       # Static assets + logo
```

---

## Testing

```bash
pnpm lint                # ESLint
pnpm test:mock           # End-to-end mock call/transcript sanity flow
```

`pnpm test:mock` expects the app running locally and exercises `/start`, `/api/tenant/phone`, `/api/twilio/webhook`, and `/api/call/live`.

---

## Deployment

Configured for Vercel. Import the repo into Vercel, set the environment variables above, run the SQL migrations in Supabase, and verify Twilio can reach your deployed `/api/twilio/webhook` endpoint.

---

## Reflection

Our main challenge was designing something people could realistically use during a high-stress scam call, so we focused on a simple, fast user flow. We also attended Lucas Maley’s PM workshop, which helped us think more clearly about product design and feature prioritization.

---

## License

This project was created as a hackathon prototype and is provided for demonstration purposes only.

No license is granted at this time. You may not use, copy, modify, or distribute this code without permission from the authors. A production license may be added in the future.
