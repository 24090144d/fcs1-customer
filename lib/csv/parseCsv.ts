/**
 * Browser-side CSV streaming parser — IM, JO, MO, and CO modules.
 * Uses PapaParse in chunk mode for files ≥ CHUNK_THRESHOLD_BYTES (10 MB).
 * Files below the threshold are parsed in a single pass for lower overhead.
 *
 * This module is client-only (it uses the File/Blob API). Never import it
 * from a Server Component or API route.
 */

import Papa from 'papaparse';

import {
  CHUNK_THRESHOLD_BYTES,
  MAX_FILE_BYTES,
  MAX_ERRORS_COLLECTED,
  PROGRESS_THROTTLE_MS,
} from '@/types/csv';
import type {
  CsvParseConfig,
  ModuleCode,
  ParsePhase,
  ParseProgress,
  ParseResult,
  ValidationError,
} from '@/types/csv';
import { validateHeaders, validateImRow, validateJoRow, validateMoRow, validateCoRow } from '@/lib/validation/csvSchema';

// ── Internal parse state ──────────────────────────────────────────────────────

interface ParseState {
  totalRows:      number;
  validRows:      number;
  invalidRows:    number;
  errors:         ValidationError[];
  startMs:        number;
  headersChecked: boolean;
  aborted:        boolean;
}

function freshState(): ParseState {
  return {
    totalRows: 0, validRows: 0, invalidRows: 0,
    errors: [], startMs: Date.now(),
    headersChecked: false, aborted: false,
  };
}

// ── Progress helpers ──────────────────────────────────────────────────────────

function makeProgress(
  phase:          ParsePhase,
  state:          ParseState,
  bytesProcessed: number,
  totalBytes:     number,
  errorMessage?:  string,
): ParseProgress {
  return {
    phase,
    bytesProcessed,
    totalBytes,
    rowsProcessed: state.totalRows,
    validRows:     state.validRows,
    invalidRows:   state.invalidRows,
    pct: totalBytes > 0 ? Math.min(100, Math.round((bytesProcessed / totalBytes) * 100)) : 0,
    errorMessage,
  };
}

/** Throttled progress emitter — updates UI at most every PROGRESS_THROTTLE_MS */
function makeProgressEmitter(
  onProgress: CsvParseConfig['onProgress'],
  state: ParseState,
  totalBytes: number,
) {
  let lastEmitMs = 0;
  return (phase: ParsePhase, bytesProcessed: number, force = false) => {
    if (!onProgress) return;
    const now = Date.now();
    if (force || now - lastEmitMs >= PROGRESS_THROTTLE_MS) {
      lastEmitMs = now;
      onProgress(makeProgress(phase, state, bytesProcessed, totalBytes));
    }
  };
}

// ── Per-row processing ────────────────────────────────────────────────────────

function processRow(
  raw:      Record<string, string>,
  rowNum:   number,
  module:   ModuleCode,
  state:    ParseState,
  config:   CsvParseConfig,
): void {
  state.totalRows++;

  const { row, errors } =
    module === 'IM'
      ? validateImRow(raw, rowNum)
      : module === 'JO'
        ? validateJoRow(raw, rowNum)
        : module === 'MO'
          ? validateMoRow(raw, rowNum)
          : validateCoRow(raw, rowNum);

  if (row) {
    state.validRows++;
    config.onValidRow?.(row, rowNum);
  } else {
    state.invalidRows++;
    if (state.errors.length < MAX_ERRORS_COLLECTED) {
      const slots = MAX_ERRORS_COLLECTED - state.errors.length;
      state.errors.push(...errors.slice(0, slots));
    }
    config.onInvalidRow?.(raw, errors);
  }
}

// ── Header check (shared) ─────────────────────────────────────────────────────

function checkHeaders(
  fields:  string[] | undefined,
  module:  ModuleCode,
  state:   ParseState,
  config:  CsvParseConfig,
  abort:   () => void,
): boolean {
  state.headersChecked = true;
  const { ok, missing } = validateHeaders(fields ?? [], module);
  if (!ok) {
    const msg = `Missing required columns for ${module}: ${missing.join(', ')}`;
    state.aborted = true;
    abort();
    config.onError?.(msg);
    config.onProgress?.(makeProgress('error', state, 0, 0, msg));
  }
  return ok;
}

// ── Small-file parser (< CHUNK_THRESHOLD_BYTES) ───────────────────────────────

function parseSmall(file: File, config: CsvParseConfig): Promise<ParseResult> {
  return new Promise((resolve, reject) => {
    const state   = freshState();
    const emit    = makeProgressEmitter(config.onProgress, state, file.size);
    const module  = config.module;

    emit('reading', 0, true);

    Papa.parse<Record<string, string>>(file, {
      header:         true,
      skipEmptyLines: true,
      worker:         config.useWorker ?? false,

      complete(results) {
        if (!checkHeaders(results.meta.fields, module, state, config, () => {})) {
          reject(new Error(config.onError?.toString()));
          return;
        }

        let rowNum = 1;
        for (const raw of results.data) {
          processRow(raw as Record<string, string>, rowNum++, module, state, config);

          // Emit throttled progress based on row index
          if (rowNum % 500 === 0) {
            const approxBytes = Math.round((rowNum / results.data.length) * file.size);
            emit('parsing', approxBytes);
          }
        }

        const result: ParseResult = {
          module,
          totalRows:   state.totalRows,
          validRows:   state.validRows,
          invalidRows: state.invalidRows,
          errors:      state.errors,
          durationMs:  Date.now() - state.startMs,
        };

        emit('complete', file.size, true);
        config.onComplete?.(result);
        resolve(result);
      },

      error(err) {
        config.onError?.(err.message);
        reject(new Error(err.message));
      },
    });
  });
}

// ── Large-file chunk parser (≥ CHUNK_THRESHOLD_BYTES) ────────────────────────

function parseLarge(file: File, config: CsvParseConfig): Promise<ParseResult> {
  return new Promise((resolve, reject) => {
    const state  = freshState();
    const emit   = makeProgressEmitter(config.onProgress, state, file.size);
    const module = config.module;
    let rowNum   = 1;
    let abortFn: (() => void) | null = null;

    emit('reading', 0, true);

    Papa.parse<Record<string, string>>(file, {
      header:         true,
      skipEmptyLines: true,
      chunkSize:      1024 * 1024,          // 1 MB per chunk
      worker:         config.useWorker ?? false,

      chunk(chunk, parser) {
        // Validate headers on the very first chunk
        if (!state.headersChecked) {
          abortFn = () => parser.abort();
          if (!checkHeaders(chunk.meta.fields, module, state, config, () => parser.abort())) {
            reject(new Error(`Missing required columns`));
            return;
          }
        }

        for (const raw of chunk.data) {
          processRow(raw as Record<string, string>, rowNum++, module, state, config);
        }

        // cursor is the byte offset PapaParse has read so far
        const bytesRead = chunk.meta.cursor ?? 0;
        emit('parsing', bytesRead);
      },

      complete() {
        if (state.aborted) return;

        const result: ParseResult = {
          module,
          totalRows:   state.totalRows,
          validRows:   state.validRows,
          invalidRows: state.invalidRows,
          errors:      state.errors,
          durationMs:  Date.now() - state.startMs,
        };

        emit('complete', file.size, true);
        config.onComplete?.(result);
        resolve(result);
      },

      error(err) {
        if (state.aborted) return;
        config.onError?.(err.message);
        reject(new Error(err.message));
      },
    });

    void abortFn; // referenced above; listed here to satisfy linter
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Parse a CSV file for the given module, emitting progress and rows via callbacks.
 *
 * - Files < 10 MB  → single-pass (no chunking)
 * - Files ≥ 10 MB  → 1 MB chunk streaming
 * - Files > 20 MB  → rejected immediately
 *
 * onValidRow is called once per valid row — do NOT accumulate in a large array
 * for big files; batch-insert to Supabase from inside the callback instead.
 */
export async function parseCsv(
  file:   File,
  config: CsvParseConfig,
): Promise<ParseResult> {
  if (file.size > MAX_FILE_BYTES) {
    const maxMb = Math.floor(MAX_FILE_BYTES / (1024 * 1024));
    const msg = `File exceeds the ${maxMb} MB limit (${(file.size / (1024 * 1024)).toFixed(1)} MB).`;
    config.onError?.(msg);
    throw new Error(msg);
  }

  return file.size < CHUNK_THRESHOLD_BYTES
    ? parseSmall(file, config)
    : parseLarge(file, config);
}
