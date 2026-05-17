-- Migration 006: publish state for builder rollout

alter table public.ai_chart_definitions
  add column if not exists is_published boolean not null default false;

alter table public.ai_chart_definitions
  add column if not exists published_at timestamptz null;

create index if not exists ai_chart_definitions_published_idx
  on public.ai_chart_definitions (organization_id, module_code, is_published, created_at desc);

