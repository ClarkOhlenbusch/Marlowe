-- Durable live call state for Twilio-based passive transcription.

create table if not exists public.live_calls (
  call_sid text primary key,
  slug text not null references public.tenants (slug) on delete cascade,
  status text not null default 'queued',
  assistant_muted boolean not null default true,
  analyzing boolean not null default false,
  last_error text,
  advice jsonb not null default jsonb_build_object(
    'riskScore', 20,
    'riskLevel', 'low',
    'feedback', 'Listening for risk signals. Stay calm and ask verifying questions.',
    'whatToSay', 'Can you verify your company, case number, and callback number?',
    'whatToDo', 'Do not share codes, account logins, or payment details.',
    'nextSteps', jsonb_build_array(
      'Ask for their full name and department.',
      'Say you will call back using an official number.'
    ),
    'confidence', 0.3,
    'updatedAt', 0
  ),
  last_advice_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_live_calls_slug on public.live_calls (slug);
create index if not exists idx_live_calls_updated_at on public.live_calls (updated_at desc);

create table if not exists public.live_transcript_chunks (
  id bigint generated always as identity primary key,
  call_sid text not null references public.live_calls (call_sid) on delete cascade,
  source_event_id text not null,
  speaker text not null check (speaker in ('caller', 'other', 'unknown')),
  text text not null,
  is_final boolean not null default false,
  timestamp_ms bigint not null,
  created_at timestamptz not null default now(),
  unique (call_sid, source_event_id)
);

create index if not exists idx_live_transcript_call_sid_id
  on public.live_transcript_chunks (call_sid, id desc);

create index if not exists idx_live_transcript_call_sid_created_at
  on public.live_transcript_chunks (call_sid, created_at desc);

alter table public.live_calls enable row level security;
alter table public.live_transcript_chunks enable row level security;

-- No anon policies: server-side service role performs all writes/reads.
