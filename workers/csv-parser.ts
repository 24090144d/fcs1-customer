/**
 * CSV Parser Web Worker
 *
 * Receives a WorkerRequest, runs parseCsv off the main thread, and posts
 * WorkerResponse messages back.
 *
 * NOTE: PapaParse worker mode + Next.js webpack requires the worker to be
 * loaded via `new Worker(new URL('./csv-parser.ts', import.meta.url))` and
 * next.config.js must NOT use `output: 'export'`. The caller (onboarding page)
 * falls back to main-thread parsing automatically if the worker fails to load.
 *
 * Message protocol is defined in @/types/csv — WorkerRequest / WorkerResponse.
 */

import type { WorkerRequest, WorkerResponse, ParseProgress, ParsedRow, ValidationError } from '@/types/csv';
import { parseCsv } from '@/lib/csv/parseCsv';

self.addEventListener('message', async (event: MessageEvent<WorkerRequest>) => {
  const { type, module, buffer, name, size } = event.data;

  if (type !== 'START') return;

  // Reconstruct a File from the transferred ArrayBuffer
  const file = new File([buffer], name, { type: 'text/csv' });

  try {
    await parseCsv(file, {
      module,

      onProgress(p: ParseProgress) {
        const msg: WorkerResponse = { type: 'PROGRESS', data: p };
        self.postMessage(msg);
      },

      onValidRow(row: ParsedRow, rowNumber: number) {
        const msg: WorkerResponse = { type: 'VALID_ROW', row, rowNumber };
        self.postMessage(msg);
      },

      onInvalidRow(raw: Record<string, string>, errors: ValidationError[]) {
        const msg: WorkerResponse = { type: 'INVALID_ROW', raw, errors };
        self.postMessage(msg);
      },

      onComplete(result) {
        const msg: WorkerResponse = { type: 'COMPLETE', result };
        self.postMessage(msg);
      },

      onError(message: string) {
        const msg: WorkerResponse = { type: 'ERROR', message };
        self.postMessage(msg);
      },
    });
  } catch (err) {
    const msg: WorkerResponse = {
      type:    'ERROR',
      message: err instanceof Error ? err.message : 'Unknown worker error',
    };
    self.postMessage(msg);
  }
});

export type { WorkerRequest, WorkerResponse };
