-- Migration 005: AI chart playground persistence

create table if not exists public.ai_chart_definitions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  title text not null,
  chart_type text not null,
  module_code text not null check (module_code in ('im', 'jo')),
  prompt text not null,
  query_spec_json jsonb not null default '{}'::jsonb,
  chart_config_json jsonb not null,
  created_by text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_chart_visibility (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  chart_id uuid not null references public.ai_chart_definitions(id) on delete cascade,
  is_hidden boolean not null default false,
  updated_at timestamptz not null default now(),
  unique (user_id, chart_id)
);

create index if not exists ai_chart_definitions_org_idx on public.ai_chart_definitions (organization_id, module_code, created_at desc);
create index if not exists user_chart_visibility_user_idx on public.user_chart_visibility (user_id, is_hidden);
