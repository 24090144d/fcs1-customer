-- Migration 011: Add computed/derived columns to jo_records
-- Depends on 010 (vip_code, is_vip already added)
--
--   actual_duration  numeric  — HH:MM → total minutes (source: total_hour_between_created_to_completed)
--   is_ontime        boolean  — true when delay_duration is null / '' / all-zeros (e.g. '00:00')
--   is_complete      boolean  — true when job_status = 'Completed'

ALTER TABLE public.jo_records
  ADD COLUMN IF NOT EXISTS actual_duration numeric,
  ADD COLUMN IF NOT EXISTS is_ontime       boolean,
  ADD COLUMN IF NOT EXISTS is_complete     boolean;

-- Back-fill from existing column values
UPDATE public.jo_records
SET
  -- Parse "HH:MM" or plain numeric → minutes
  actual_duration = CASE
    WHEN total_hour_between_created_to_completed IS NULL
      OR TRIM(total_hour_between_created_to_completed) = ''           THEN NULL
    WHEN TRIM(total_hour_between_created_to_completed) ~ '^\d+:\d+'  THEN
      SPLIT_PART(TRIM(total_hour_between_created_to_completed), ':', 1)::integer * 60
      + SPLIT_PART(TRIM(total_hour_between_created_to_completed), ':', 2)::integer
    WHEN TRIM(total_hour_between_created_to_completed) ~ '^\d+(\.\d+)?$' THEN
      TRIM(total_hour_between_created_to_completed)::numeric
    ELSE NULL
  END,

  -- On-time: null / empty / string containing only '0' and ':' chars
  is_ontime = (
    delay_duration IS NULL
    OR TRIM(delay_duration) = ''
    OR TRIM(delay_duration) ~ '^[0:]+$'
  ),

  -- Complete: status exactly equals 'Completed'
  is_complete = (job_status = 'Completed')

WHERE module_code = 'jo';
