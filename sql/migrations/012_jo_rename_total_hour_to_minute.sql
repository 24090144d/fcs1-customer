-- Migration 012: Rename total_hour_between_created_to_completed
--   → total_minute_between_created_to_completed
--
-- The original Excel column header "Total Hour Between Created to Completed"
-- is a typo; the stored values are in minutes (HH:MM format where the left
-- part is hours, effectively minutes for sub-1-hour jobs).
-- Rename makes the semantics explicit.

ALTER TABLE public.jo_records
  RENAME COLUMN total_hour_between_created_to_completed
             TO total_minute_between_created_to_completed;
