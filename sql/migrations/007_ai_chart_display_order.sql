-- Migration 007: builder ordering support

alter table public.ai_chart_definitions
  add column if not exists display_order integer null;

create index if not exists ai_chart_definitions_order_idx
  on public.ai_chart_definitions (organization_id, module_code, is_active, display_order, created_at desc);

