-- Migration 013: Add respond_time (minutes) to jo_records
--   respond_time = acknowledged_datetime - created_datetime, in whole minutes

ALTER TABLE public.jo_records
  ADD COLUMN IF NOT EXISTS respond_time numeric;

-- Back-fill from existing timestamp columns
UPDATE public.jo_records
SET respond_time = ROUND(
  EXTRACT(EPOCH FROM (acknowledged_datetime - created_datetime)) / 60
)
WHERE module_code = 'jo'
  AND acknowledged_datetime IS NOT NULL
  AND created_datetime      IS NOT NULL;
