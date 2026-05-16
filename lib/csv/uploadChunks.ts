/**
 * Client-side chunk uploader — sends pre-parsed rows to /api/uploads/chunk
 * in batches of UPLOAD_CHUNK_SIZE with exponential-backoff retry.
 *
 * This module is client-only. Never import from a Server Component or API route.
 */

import type { ChunkRequest, ChunkResponse } from '@/app/api/uploads/chunk/route';

// ── Constants ─────────────────────────────────────────────────────────────────

export const UPLOAD_CHUNK_SIZE = 1_000;   // rows per request
const MAX_RETRIES  = 3;                   // attempts after initial failure
const RETRY_DELAYS = [1_000, 2_000, 4_000] as const; // ms between retries

// ── Types ─────────────────────────────────────────────────────────────────────

export interface UploadRow {
  row_number:  number;
  raw_row:     Record<string, unknown>;
  is_valid:    boolean;
  parse_error: string | null;
}

export interface ChunkUploadProgress {
  chunkIndex:   number;
  totalChunks:  number;
  rowsUploaded: number;
  totalRows:    number;
  pct:          number;  // 0–100
}

export interface ChunkRetryEvent {
  chunkIndex:  number;
  attempt:     number;
  maxAttempts: number;
  error:       string;
}

export interface UploadChunksOptions {
  upload_job_id:    string;
  uploaded_file_id: string;
  rows:             UploadRow[];
  onProgress:       (p: ChunkUploadProgress) => void;
  onRetry:          (e: ChunkRetryEvent) => void;
}

export interface UploadChunksResult {
  totalInserted: number;
  totalSkipped:  number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toChunks<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function uploadChunks({
  upload_job_id,
  uploaded_file_id,
  rows,
  onProgress,
  onRetry,
}: UploadChunksOptions): Promise<UploadChunksResult> {
  const chunks      = toChunks(rows, UPLOAD_CHUNK_SIZE);
  const totalChunks = Math.max(chunks.length, 1); // at least 1 for the empty-rows case
  let totalInserted = 0;
  let totalSkipped  = 0;
  let rowsUploaded  = 0;

  // Always send at least one request so the server can finalise the job,
  // even when the file had zero valid rows.
  const chunkList = chunks.length > 0 ? chunks : [[] as UploadRow[]];

  for (let i = 0; i < chunkList.length; i++) {
    const chunk       = chunkList[i];
    const isLastChunk = i === chunkList.length - 1;
    let   lastError: Error | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        onRetry({
          chunkIndex:  i,
          attempt,
          maxAttempts: MAX_RETRIES + 1,
          error:       lastError?.message ?? 'Unknown error',
        });
        await sleep(RETRY_DELAYS[attempt - 1] ?? 4_000);
      }

      try {
        const body: ChunkRequest = {
          upload_job_id,
          uploaded_file_id,
          chunk_index:      i,
          is_last_chunk:    isLastChunk,
          total_valid_rows: isLastChunk ? rows.length : null,
          rows:             chunk,
        };

        const res = await fetch('/api/uploads/chunk', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(body),
        });

        if (!res.ok) {
          const errJson = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
          throw new Error((errJson as { error?: string }).error ?? `HTTP ${res.status}`);
        }

        const data = await res.json() as ChunkResponse;
        totalInserted += data.inserted;
        totalSkipped  += data.skipped;
        rowsUploaded  += chunk.length;

        onProgress({
          chunkIndex:   i,
          totalChunks,
          rowsUploaded,
          totalRows:    rows.length,
          pct:          rows.length > 0
            ? Math.min(100, Math.round((rowsUploaded / rows.length) * 100))
            : 100,
        });

        lastError = null;
        break; // success — advance to next chunk
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt === MAX_RETRIES) {
          throw new Error(
            `Chunk ${i + 1}/${totalChunks} failed after ${MAX_RETRIES + 1} attempts: ${lastError.message}`,
          );
        }
      }
    }
  }

  return { totalInserted, totalSkipped };
}
