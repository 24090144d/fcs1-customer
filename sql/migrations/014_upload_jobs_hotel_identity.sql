-- Migration 014: Store hotel/chain identity directly on upload_jobs
--
-- Root cause: finalize/route.ts previously had to re-derive chain/hotel/country
-- identity by looking up uploaded_files.file_name for the job (falling back to
-- staging rows if no uploaded_files row existed for the job directly), then
-- parsing that filename. If uploaded_files' file_hash-based dedup ever reused
-- a row from a DIFFERENT job (e.g. an unexpected hash match), finalize would
-- silently derive the wrong hotel_code from that other job's stale filename,
-- mistagging every record in the new job under the wrong hotel.
--
-- create-job already resolves and knows this identity at request time — store
-- it directly on the job so finalize never has to re-derive it from a file
-- lookup that can resolve to the wrong row.

ALTER TABLE public.upload_jobs
  ADD COLUMN IF NOT EXISTS chain_code   text,
  ADD COLUMN IF NOT EXISTS hotel_code   text,
  ADD COLUMN IF NOT EXISTS hotel_name   text,
  ADD COLUMN IF NOT EXISTS country_code text,
  ADD COLUMN IF NOT EXISTS data_range   text;
