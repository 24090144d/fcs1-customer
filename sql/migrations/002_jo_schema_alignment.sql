-- Align jo_records with JO CSV headers used in:
-- data/Wynn-WM-Wynn Macau-JO-MO-1m.csv

alter table if exists public.jo_records
  add column if not exists created_by_department text,
  add column if not exists created_by_user text,
  add column if not exists assigned_to_department text,
  add column if not exists assigned_to_user text,
  add column if not exists acknowledged_by_department text,
  add column if not exists acknowledged_by_user text,
  add column if not exists completed_by_department text,
  add column if not exists completed_by_user text,
  add column if not exists total_hour_between_created_to_completed text,
  add column if not exists total_act_between_acknowledged_to_completed text,
  add column if not exists comments text,
  add column if not exists attachment text,
  add column if not exists reassigned_job text,
  add column if not exists escalation_group text;

create index if not exists jo_records_service_item_category_idx
  on public.jo_records (service_item_category);

create index if not exists jo_records_department_name_idx
  on public.jo_records (department_name);

create index if not exists jo_records_job_order_idx
  on public.jo_records (job_order);
