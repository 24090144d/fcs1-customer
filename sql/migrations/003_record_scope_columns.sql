-- Add scope columns used for dashboard filtering and corp analytics.
-- Columns sourced from upload filename pattern:
-- [ChainCode]-[HotelCode]-[HotelName]-[ModuleCode]-[CountryCode]-[DataRange].csv

alter table if exists public.im_records
  add column if not exists chain_code text,
  add column if not exists hotel_code text,
  add column if not exists module_code text,
  add column if not exists country_code text;

alter table if exists public.jo_records
  add column if not exists chain_code text,
  add column if not exists hotel_code text,
  add column if not exists module_code text,
  add column if not exists country_code text;

-- Backfill from uploaded_files file_name (prefer row-linked file, fallback to latest file in same upload_job_id)
with file_src as (
  select
    r.id as record_id,
    coalesce(
      uf.file_name,
      (
        select uf2.file_name
        from public.uploaded_files uf2
        where uf2.upload_job_id = r.upload_job_id
        order by uf2.uploaded_at desc
        limit 1
      )
    ) as file_name
  from public.im_records r
  left join public.uploaded_files uf on uf.id = r.uploaded_file_id
),
parsed as (
  select
    record_id,
    regexp_match(
      coalesce(file_name, ''),
      '^([^-]+)-([^-]+)-.*-(im|jo)-([^-]+)-[^-]+\\.csv$',
      'i'
    ) as m
  from file_src
)
update public.im_records r
set
  chain_code = coalesce(r.chain_code, upper(p.m[1])),
  hotel_code = coalesce(r.hotel_code, upper(p.m[2])),
  module_code = coalesce(r.module_code, lower(p.m[3])),
  country_code = coalesce(r.country_code, upper(p.m[4]))
from parsed p
where p.record_id = r.id
  and p.m is not null;

with file_src as (
  select
    r.id as record_id,
    coalesce(
      uf.file_name,
      (
        select uf2.file_name
        from public.uploaded_files uf2
        where uf2.upload_job_id = r.upload_job_id
        order by uf2.uploaded_at desc
        limit 1
      )
    ) as file_name
  from public.jo_records r
  left join public.uploaded_files uf on uf.id = r.uploaded_file_id
),
parsed as (
  select
    record_id,
    regexp_match(
      coalesce(file_name, ''),
      '^([^-]+)-([^-]+)-.*-(im|jo)-([^-]+)-[^-]+\\.csv$',
      'i'
    ) as m
  from file_src
)
update public.jo_records r
set
  chain_code = coalesce(r.chain_code, upper(p.m[1])),
  hotel_code = coalesce(r.hotel_code, upper(p.m[2])),
  module_code = coalesce(r.module_code, lower(p.m[3])),
  country_code = coalesce(r.country_code, upper(p.m[4]))
from parsed p
where p.record_id = r.id
  and p.m is not null;

create index if not exists im_records_scope_idx
  on public.im_records (chain_code, hotel_code, module_code, country_code);

create index if not exists jo_records_scope_idx
  on public.jo_records (chain_code, hotel_code, module_code, country_code);
