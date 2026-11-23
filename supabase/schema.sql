-- Novel Words: run this once in Supabase → SQL Editor → New query → Run.
-- One table holds every synced record (sections, words, check-ins, settings) as JSON.

create table if not exists public.records (
  user_id           uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  kind              text        not null,
  id                text        not null,
  updated_at        timestamptz not null,
  deleted           boolean     not null default false,
  data              jsonb       not null,
  server_updated_at timestamptz not null default clock_timestamp(),
  primary key (user_id, kind, id)
);

create index if not exists records_pull_idx on public.records (user_id, server_updated_at);

-- Last-write-wins: ignore an update that is older than what is already stored,
-- and stamp accepted writes with a unique server time (used as the pull cursor).
create or replace function public.records_lww() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' and new.updated_at < old.updated_at then
    return old;
  end if;
  new.server_updated_at := clock_timestamp();
  return new;
end;
$$;

drop trigger if exists records_lww on public.records;
create trigger records_lww before insert or update on public.records
for each row execute function public.records_lww();

-- Each user can only see and change their own rows.
alter table public.records enable row level security;

drop policy if exists "own records" on public.records;
create policy "own records" on public.records
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
