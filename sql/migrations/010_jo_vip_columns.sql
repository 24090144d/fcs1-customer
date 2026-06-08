-- Migration 010: Add vip_code and is_vip columns to jo_records
-- is_vip = true when vip_code is not null, not '0', not '-', not empty/whitespace

ALTER TABLE public.jo_records
  ADD COLUMN IF NOT EXISTS vip_code text,
  ADD COLUMN IF NOT EXISTS is_vip  boolean;

-- Back-fill is_vip from normalized_row JSONB for existing rows
UPDATE public.jo_records
SET
  vip_code = NULLIF(TRIM((normalized_row->>'vip_code')::text), ''),
  is_vip   = (
    normalized_row->>'vip_code' IS NOT NULL
    AND TRIM(normalized_row->>'vip_code') <> ''
    AND TRIM(normalized_row->>'vip_code') <> '-'
    AND TRIM(normalized_row->>'vip_code') <> '0'
  )
WHERE module_code = 'jo';
