# The Scam Detective Hotline

A hackathon project that helps people pause before they get scammed. Users submit their phone number, tap **Open a Case**, and receive a callback from an AI detective assistant for a fast second opinion.

## Team
- Clark Ohlenbusch
- Michael Marrero
- Julie Hohenberg

## Hackathon Build Notes
This project was built with a hybrid workflow:
- Framework + initial skeleton generated with **Vercel v0**
- Extended and refined with **handwritten code**
- AI-assisted iteration using **Codex**, **Claude Code**, **Gemini CLI**, and **Kiro CLI**
- Deployed on **Vercel**
- **Supabase** used for backend services/infrastructure
- **Vapi (Voice API)** used for voice agent orchestration and call initiation
- **Twilio** used for number provisioning to the voice agent

## Tech Stack
- **Framework:** Next.js 16 (App Router), React 19, TypeScript
- **UI:** Tailwind CSS v4, Radix UI primitives, shadcn-style component architecture
- **Backend/API:** Next.js Route Handlers (`app/api/call/route.ts`)
- **Voice/Calling:** Vapi (voice agent orchestration + call initiation), Twilio (number provisioning)
- **Infra:** Vercel deployment + Supabase backend services

## Features
- Guided setup flow to capture and normalize user phone numbers
- E.164 phone validation and masking utilities
- One-tap case flow with clear states: idle, dialing, success, error
- Server-side call initiation with safe error handling

## Getting Started
### Prerequisites
- Node.js 20+
- `pnpm`

### Install and run
```bash
pnpm install
pnpm dev
```
Open `http://localhost:3000`.

### Production build
```bash
pnpm build
pnpm start
```

### Lint
```bash
pnpm lint
```

## Environment Variables
Create `.env.local` with at least:

```bash
VAPI_PRIVATE_KEY=...
VAPI_ASSISTANT_ID=...
VAPI_PHONE_NUMBER_ID=...
```

Supabase-related variables may also be required for backend features (for example `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and service credentials) depending on your environment.

## Project Structure
```text
app/                 # pages, layout, route handlers
app/api/call/        # call initiation endpoint
components/          # app and UI components
hooks/               # reusable React hooks
lib/                 # utilities (phone parsing/validation)
public/              # static assets
```

## Deployment
This project is configured for Vercel deployment. Push to your Git provider and import the repo in Vercel, then add required environment variables in project settings.

## License
Hackathon prototype. Add a license before production use.
