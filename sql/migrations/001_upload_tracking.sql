-- Migration 001: Upload tracking tables
-- Run this in the Supabase SQL editor.

-- ── upload_jobs ───────────────────────────────────────────────────────────────
-- One row per upload attempt. Created before parsing begins; updated on complete.

create table if not exists public.upload_jobs (
  id              uuid        primary key default gen_random_uuid(),
  module_code     text        not null check (module_code in ('im', 'jo')),
  upload_mode     text        not null check (upload_mode in ('replace', 'append', 'upsert')),
  status          text        not null default 'pending'
                              check (status in ('pending', 'processing', 'complete', 'failed')),
  file_name       text        not null,
  file_hash       text        not null,
  file_size       bigint      not null,
  chain_code      text,
  hotel_code      text,
  hotel_name      text,
  country_code    text,
  data_range      text,
  total_rows      integer,
  valid_rows      integer,
  invalid_rows    integer,
  error_message   text,
  created_at      timestamptz not null default now(),
  completed_at    timestamptz
);

alter table public.upload_jobs enable row level security;

-- For now: service role only (no user auth yet — tighten when auth is added)
do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'upload_jobs'
      and policyname = 'Service role full access on upload_jobs'
  ) then
    create policy "Service role full access on upload_jobs"
      on public.upload_jobs
      using (true)
      with check (true);
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'upload_jobs' and column_name = 'file_hash'
  ) then
    create index if not exists upload_jobs_file_hash_idx on public.upload_jobs (file_hash);
  end if;
end $$;

create index if not exists upload_jobs_module_code_idx on public.upload_jobs (module_code);
create index if not exists upload_jobs_status_idx on public.upload_jobs (status);
create index if not exists upload_jobs_created_at_idx on public.upload_jobs (created_at desc);

-- ── uploaded_files ────────────────────────────────────────────────────────────
-- Hash registry — one row per unique file content (SHA-256).
-- Used for duplicate detection before parsing starts.

create table if not exists public.uploaded_files (
  id                  uuid        primary key default gen_random_uuid(),
  file_hash           text        not null unique,
  file_name           text        not null,
  file_size           bigint      not null,
  module_code         text        not null,
  chain_code          text,
  hotel_code          text,
  hotel_name          text,
  country_code        text,
  data_range          text,
  upload_job_id       uuid        not null references public.upload_jobs(id) on delete cascade,
  first_uploaded_at   timestamptz not null default now()
);

alter table public.uploaded_files enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'uploaded_files'
      and policyname = 'Service role full access on uploaded_files'
  ) then
    create policy "Service role full access on uploaded_files"
      on public.uploaded_files
      using (true)
      with check (true);
  end if;
end $$;

create index if not exists uploaded_files_file_hash_idx on public.uploaded_files (file_hash);
