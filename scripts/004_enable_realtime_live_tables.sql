-- Enable Supabase Realtime broadcasting for live coaching tables.
-- Demo posture: broad read policies for fast iteration.

alter table public.live_calls replica identity full;
alter table public.live_transcript_chunks replica identity full;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'live_calls'
    ) then
      execute 'alter publication supabase_realtime add table public.live_calls';
    end if;

    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'live_transcript_chunks'
    ) then
      execute 'alter publication supabase_realtime add table public.live_transcript_chunks';
    end if;
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'live_calls'
      and policyname = 'live_calls_demo_read'
  ) then
    create policy live_calls_demo_read
      on public.live_calls
      for select
      to anon, authenticated
      using (true);
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'live_transcript_chunks'
      and policyname = 'live_transcript_chunks_demo_read'
  ) then
    create policy live_transcript_chunks_demo_read
      on public.live_transcript_chunks
      for select
      to anon, authenticated
      using (true);
  end if;
end
$$;
