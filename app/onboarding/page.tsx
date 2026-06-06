'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { RotateCcw, ArrowRight, RefreshCw } from 'lucide-react';
import Link from 'next/link';

import { AppLayout }          from '@/components/layout/AppLayout';
import { DropZone }           from '@/components/upload/DropZone';
import { FileMetadata }       from '@/components/upload/FileMetadata';
import { UploadModeSelector } from '@/components/upload/UploadModeSelector';
import { ValidationPanel }    from '@/components/upload/ValidationPanel';
import { DuplicateWarning }   from '@/components/upload/DuplicateWarning';
import { ProgressBar }        from '@/components/upload/ProgressBar';
import { parseCsv }           from '@/lib/csv/parseCsv';
import { hashFile }           from '@/lib/csv/hashFile';
import { uploadChunks }       from '@/lib/csv/uploadChunks';

import type { ParsedFileName }    from '@/components/upload/FileMetadata';
import type { UploadMode }        from '@/components/upload/UploadModeSelector';
import type { ValidationMessage } from '@/components/upload/ValidationPanel';
import type { ModuleCode, ParsedRow } from '@/types/csv';
import type { CheckFileResponse }  from '@/app/api/uploads/check-file/route';
import type { CreateJobRequest, CreateJobResponse } from '@/app/api/uploads/create-job/route';
import type { FinalizeRequest, FinalizeResponse } from '@/app/api/uploads/finalize/route';
import type { UploadRow, ChunkUploadProgress } from '@/lib/csv/uploadChunks';
import { useI18n } from '@/components/layout/I18nProvider';
import { MAX_FILE_BYTES, MAX_ERRORS_COLLECTED } from '@/types/csv';
import type { ModuleCodeDb } from '@/types';

// ── Types ─────────────────────────────────────────────────────────────────────

type UploadStatus =
  | 'idle'
  | 'hashing'
  | 'ready'
  | 'checking'
  | 'parsing'
  | 'uploading'
  | 'finalizing'
  | 'success'
  | 'error';

interface ParseStats {
  totalRows:   number;
  validRows:   number;
  invalidRows: number;
}

interface DuplicateInfo {
  previousFileName: string;
  firstUploadedAt:  string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseFileName(filename: string): ParsedFileName | null {
  const nameWithoutExt = filename.replace(/\.csv$/i, '');
  const parts = nameWithoutExt.split('-');
  if (parts.length < 6) return null;
  let moduleIndex = -1;
  for (let i = 2; i < parts.length - 1; i++) {
    if (/^(IM|JO|MO|CO)$/i.test(parts[i])) {
      moduleIndex = i;
      break;
    }
  }
  if (moduleIndex < 0) return null;
  return {
    chainCode:   parts[0],
    hotelCode:   parts[1],
    hotelName:   parts.slice(2, moduleIndex).join('-'),
    module:      parts[moduleIndex],
    countryCode: parts[moduleIndex + 1],
    dataRange:   parts.slice(moduleIndex + 2).join('-'),
    isValid:     true,
  };
}

const KNOWN_MODULES: ModuleCode[] = ['IM', 'JO', 'MO', 'CO'];

function buildValidationMessages(file: File, parsed: ParsedFileName | null): ValidationMessage[] {
  const msgs: ValidationMessage[] = [];

  if (!parsed) {
    msgs.push({
      id:       'fn-format',
      severity: 'error',
      message:  'File name does not match required format: [ChainCode]-[HotelCode]-[HotelName]-[Module]-[CountryCode]-[DataRange].csv',
    });
    return msgs;
  }

  msgs.push({
    id:       'fn-ok',
    severity: 'success',
    message:  `File name parsed — Chain: ${parsed.chainCode} · Hotel: ${parsed.hotelName} (${parsed.hotelCode}) · Module: ${parsed.module} · Period: ${parsed.dataRange} · Country: ${parsed.countryCode}`,
  });

  const moduleUpper = parsed.module.toUpperCase() as ModuleCode;
  if (!KNOWN_MODULES.includes(moduleUpper)) {
    msgs.push({
      id:       'module-unknown',
      severity: 'warning',
      message:  `Module code "${parsed.module}" is not recognised (expected: ${KNOWN_MODULES.join(' or ')}). Parsing cannot proceed.`,
    });
  } else {
    msgs.push({
      id:       'module-ok',
      severity: 'info',
      message:  `Module ${moduleUpper} recognised — CSV columns will be validated against ${moduleUpper} schema.`,
    });
  }

  if (file.size > MAX_FILE_BYTES) {
    const maxMb = Math.floor(MAX_FILE_BYTES / (1024 * 1024));
    msgs.push({
      id:       'size-error',
      severity: 'error',
      message:  `File size (${(file.size / (1024 * 1024)).toFixed(1)} MB) exceeds the ${maxMb} MB limit.`,
    });
  } else {
    const sizeLabel = file.size < 1024 * 1024
      ? `${(file.size / 1024).toFixed(1)} KB`
      : `${(file.size / (1024 * 1024)).toFixed(2)} MB`;
    const mode = file.size >= 10 * 1024 * 1024 ? 'chunk streaming' : 'single-pass';
    msgs.push({
      id:       'size-ok',
      severity: 'info',
      message:  `File size: ${sizeLabel} — will use ${mode} parser.`,
    });
  }

  return msgs;
}

function fmt(n: number) { return n.toLocaleString(); }

// ── Page ──────────────────────────────────────────────────────────────────────

export default function OnboardingPage() {
  const router = useRouter();
  const { t } = useI18n();
  const [file,              setFile]              = useState<File | null>(null);
  const [parsed,            setParsed]            = useState<ParsedFileName | null>(null);
  const [dragActive,        setDragActive]        = useState(false);
  const [uploadMode,        setUploadMode]        = useState<UploadMode>('replace');
  const [status,            setStatus]            = useState<UploadStatus>('idle');
  const [validationMsgs,    setValidationMsgs]    = useState<ValidationMessage[]>([]);

  // Hashing / dedup
  const [fileHash,          setFileHash]          = useState<string | null>(null);
  const [duplicateInfo,     setDuplicateInfo]     = useState<DuplicateInfo | null>(null);

  // Job IDs (set after create-job succeeds)
  const [uploadJobId,       setUploadJobId]       = useState<string | null>(null);
  const [uploadedFileId,    setUploadedFileId]    = useState<string | null>(null);

  // Parse phase
  const [parseProgress,     setParseProgress]     = useState(0);
  const [parseStats,        setParseStats]        = useState<ParseStats | null>(null);

  // Upload phase
  const [uploadProgress,    setUploadProgress]    = useState(0);
  const [uploadChunkStats,  setUploadChunkStats]  = useState<ChunkUploadProgress | null>(null);

  // ── Validation message helpers ───────────────────────────────────────────

  const addMsg = useCallback((msg: ValidationMessage) => {
    setValidationMsgs((prev) => [...prev, msg]);
  }, []);

  // ── File select ──────────────────────────────────────────────────────────

  const handleFileSelect = useCallback(async (selectedFile: File) => {
    const parsedName = parseFileName(selectedFile.name);
    const messages   = buildValidationMessages(selectedFile, parsedName);
    setFile(selectedFile);
    setParsed(parsedName);
    setValidationMsgs(messages);
    setStatus('hashing');
    setParseProgress(0);
    setUploadProgress(0);
    setParseStats(null);
    setUploadChunkStats(null);
    setDuplicateInfo(null);
    setFileHash(null);
    setUploadJobId(null);
    setUploadedFileId(null);

    try {
      const hash = await hashFile(selectedFile);
      setFileHash(hash);
      setStatus('ready');
    } catch {
      setValidationMsgs((prev) => [
        ...prev,
        { id: 'hash-error', severity: 'error', message: 'Failed to compute file hash. Please try again.' },
      ]);
      setStatus('error');
    }
  }, []);

  // ── Reset ────────────────────────────────────────────────────────────────

  const handleRemove = useCallback(() => {
    setFile(null);
    setParsed(null);
    setValidationMsgs([]);
    setStatus('idle');
    setParseProgress(0);
    setUploadProgress(0);
    setParseStats(null);
    setUploadChunkStats(null);
    setDuplicateInfo(null);
    setFileHash(null);
    setUploadJobId(null);
    setUploadedFileId(null);
  }, []);

  // ── Parse + upload pipeline ──────────────────────────────────────────────

  const runPipelineWithJob = useCallback(async (jobId: string, fileId: string) => {
    if (!file || !parsed) return;
    const moduleCode = parsed.module.toUpperCase() as ModuleCode;

    // ── Phase 1: parse CSV in browser ───────────────────────────────────────
    setStatus('parsing');
    setParseProgress(0);
    setParseStats(null);

    const validRows: UploadRow[] = [];

    try {
      await parseCsv(file, {
        module: moduleCode,

        onValidRow(row: ParsedRow, rowNumber: number) {
          validRows.push({
            row_number:  rowNumber,
            raw_row:     row as unknown as Record<string, unknown>,
            is_valid:    true,
            parse_error: null,
          });
        },

        onProgress(p) {
          setParseProgress(p.pct);
          setParseStats({ totalRows: p.rowsProcessed, validRows: p.validRows, invalidRows: p.invalidRows });
        },

        onComplete(result) {
          setParseProgress(100);
          setParseStats({ totalRows: result.totalRows, validRows: result.validRows, invalidRows: result.invalidRows });

          const completeMsgs: ValidationMessage[] = [
            {
              id:       'parse-complete',
              severity: 'success',
              message:  `Parsed ${fmt(result.totalRows)} rows in ${result.durationMs} ms — ${fmt(result.validRows)} valid, ${fmt(result.invalidRows)} invalid.`,
            },
          ];
          result.errors.slice(0, 5).forEach((err, i) => {
            completeMsgs.push({
              id:       `csv-err-${i}`,
              severity: 'warning',
              message:  `Row ${err.rowNumber} · ${err.field}: ${err.message}`,
            });
          });
          if (result.errors.length > 5) {
            completeMsgs.push({
              id:       'csv-err-more',
              severity: 'info',
              message:  `…and ${fmt(result.errors.length - 5)} more error(s) collected (max ${MAX_ERRORS_COLLECTED} total).`,
            });
          }
          setValidationMsgs((prev) => [...prev, ...completeMsgs]);
        },

        onError(msg) {
          setStatus('error');
          addMsg({ id: 'parse-error', severity: 'error', message: msg });
        },
      });
    } catch {
      setStatus('error');
      return;
    }

    // ── Phase 2: upload parsed rows in chunks ────────────────────────────────
    setStatus('uploading');
    setUploadProgress(0);
    setUploadChunkStats(null);

    try {
      const { totalInserted, totalSkipped } = await uploadChunks({
        upload_job_id:    jobId,
        uploaded_file_id: fileId,
        rows:             validRows,

        onProgress(p) {
          setUploadProgress(p.pct);
          setUploadChunkStats(p);
        },

        onRetry({ chunkIndex, attempt, maxAttempts, error }) {
          addMsg({
            id:       `chunk-retry-${chunkIndex}-${attempt}`,
            severity: 'warning',
            message:  `Chunk ${chunkIndex + 1} retry ${attempt}/${maxAttempts}: ${error}`,
          });
        },
      });

      setUploadProgress(100);
      addMsg({
        id:       'upload-complete',
        severity: 'info',
        message:  `Staged ${fmt(totalInserted)} rows${totalSkipped > 0 ? ` (${fmt(totalSkipped)} skipped)` : ''}. Finalizing…`,
      });
    } catch (err) {
      setStatus('error');
      addMsg({
        id:       'upload-error',
        severity: 'error',
        message:  err instanceof Error ? err.message : 'Upload failed',
      });
      return;
    }

    // ── Phase 3: finalize (staging → records → dashboard JSON) ──────────────
    setStatus('finalizing');
    try {
      const finalizeBody: FinalizeRequest = { upload_job_id: jobId };
      const res = await fetch('/api/uploads/finalize', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(finalizeBody),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`);
      }

      const { records_inserted }: FinalizeResponse = await res.json();
      setStatus('success');
      addMsg({
        id:       'finalize-complete',
        severity: 'success',
        message:  `Finalized — ${fmt(records_inserted)} records written to database. Dashboard JSON updated.`,
      });
      const dashboardHref = parsed?.module?.toLowerCase() === 'co'
        ? `/dashboard?hotel=${encodeURIComponent(parsed.hotelCode)}&module=co${parsed.chainCode ? `&chain=${encodeURIComponent(parsed.chainCode)}` : ''}`
        : `/dashboard?hotel=${encodeURIComponent(parsed.hotelCode)}&module=${encodeURIComponent(parsed.module.toLowerCase())}`;
      router.replace(dashboardHref);
    } catch (err) {
      setStatus('error');
      addMsg({
        id:       'finalize-error',
        severity: 'error',
        message:  `Finalization failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
      });
    }
  }, [file, parsed, addMsg, router]);

  // ── Create job then run pipeline ─────────────────────────────────────────

  const createJobAndRun = useCallback(async () => {
    if (!file || !parsed || !fileHash) return;

    const moduleCode = parsed.module.toUpperCase() as ModuleCode;
    const body: CreateJobRequest = {
      file_hash:    fileHash,
      file_name:    file.name,
      file_size:    file.size,
      module_code:  moduleCode.toLowerCase() as ModuleCodeDb,
      upload_mode:  uploadMode,
      chain_code:   parsed.chainCode   ?? null,
      hotel_code:   parsed.hotelCode   ?? null,
      hotel_name:   parsed.hotelName   ?? null,
      country_code: parsed.countryCode ?? null,
      data_range:   parsed.dataRange   ?? null,
    };

    let res: Response;
    try {
      res = await fetch('/api/uploads/create-job', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      });
    } catch (error) {
      addMsg({
        id:       'job-network-error',
        severity: 'error',
        message:  `Failed to reach upload service: ${error instanceof Error ? error.message : 'Network error'}`,
      });
      setStatus('error');
      return;
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      addMsg({ id: 'job-error', severity: 'error', message: `Failed to create upload job: ${(err as { error?: string }).error ?? res.statusText}` });
      setStatus('error');
      return;
    }

    const { upload_job_id, uploaded_file_id }: CreateJobResponse = await res.json();
    setUploadJobId(upload_job_id);
    setUploadedFileId(uploaded_file_id);
    await runPipelineWithJob(upload_job_id, uploaded_file_id);
  }, [file, parsed, fileHash, uploadMode, addMsg, runPipelineWithJob]);

  // ── Submit handler ────────────────────────────────────────────────────────

  const handleUpload = useCallback(async () => {
    if (!file || !parsed || !fileHash) return;
    if (isWorking(status) || status === 'success') return;

    const moduleCode = parsed.module.toUpperCase() as ModuleCode;
    if (!KNOWN_MODULES.includes(moduleCode)) {
      addMsg({ id: 'module-invalid', severity: 'error', message: `Cannot parse: module "${parsed.module}" is not IM, JO, MO, or CO.` });
      return;
    }

    // Duplicate check
    setStatus('checking');
    try {
      const res = await fetch('/api/uploads/check-file', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ file_hash: fileHash }),
      });

      if (res.ok) {
        const data: CheckFileResponse = await res.json();
        if (data.duplicate) {
          setDuplicateInfo({
            previousFileName: data.existing_file_name,
            firstUploadedAt:  data.first_uploaded_at,
          });
          setStatus('ready'); // pause; show warning
          return;
        }
      }
      // Network error or non-duplicate — proceed
    } catch { /* non-fatal: skip check */ }

    await createJobAndRun();
  }, [file, parsed, fileHash, status, addMsg, createJobAndRun]);

  const handleDuplicateContinue = useCallback(async () => {
    setDuplicateInfo(null);
    await createJobAndRun();
  }, [createJobAndRun]);

  // ── Derived ──────────────────────────────────────────────────────────────

  const hasErrors = validationMsgs.some((m) => m.severity === 'error');
  const canUpload = !!file && !!fileHash && !hasErrors && !isWorking(status) && status !== 'success';

  const showParseProgress  = status === 'parsing'    || (parseProgress > 0  && (status === 'uploading' || status === 'finalizing' || status === 'success' || status === 'error'));
  const showUploadProgress = status === 'uploading'  || (uploadProgress > 0 && (status === 'finalizing' || status === 'success'   || status === 'error'));

  function buttonLabel() {
    if (status === 'hashing')    return 'Computing hash…';
    if (status === 'checking')   return 'Checking…';
    if (status === 'parsing')    return 'Parsing…';
    if (status === 'uploading')  return t('onboarding.status_uploading', 'Uploading…');
    if (status === 'finalizing') return t('onboarding.status_finalizing', 'Finalizing…');
    if (status === 'success')    return '✓ Complete';
    return t('onboarding.button_parse_upload', 'Parse & Upload');
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <AppLayout breadcrumbs={[{ label: t('layout.breadcrumb_onboarding', 'Onboarding') }, { label: t('layout.breadcrumb_upload_csv', 'Upload CSV') }]}>
      <div className="px-4 sm:px-6 md:px-8 py-6 max-w-5xl mx-auto">

        {/* Page header */}
        <div className="mb-6 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="font-serif text-2xl font-bold text-slate-800 leading-tight">{t('onboarding.page_title', 'Upload CSV')}</h1>
            <p className="font-sans text-sm text-slate-500 mt-1 max-w-2xl">
              {t('onboarding.page_subtitle', 'Upload IM, JO, MO, or CO CSV data. IM supports incident dashboards, JO supports job-order dashboards, MO supports maintenance dashboards with MO/PM order analysis, and CO supports cleaning-order dashboards.')}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {[
                ['IM', 'Incident Management'],
                ['JO', 'Job Order'],
                ['MO', 'Maintenance Order / PM'],
                ['CO', 'Cleaning Order ACSR'],
              ].map(([code, label]) => (
                <span
                  key={code}
                  className="inline-flex items-center gap-1.5 rounded border border-slate-200 bg-white px-2.5 py-1 font-sans text-[11px] text-slate-500 shadow-sm"
                >
                  <code className="font-mono font-semibold text-teal-700">{code}</code>
                  <span>{label}</span>
                </span>
              ))}
            </div>
          </div>
          {file && (
            <button
              type="button"
              onClick={handleRemove}
              className="shrink-0 flex items-center gap-1.5 text-xs font-sans font-medium text-slate-500 hover:text-slate-800 border border-slate-200 hover:border-slate-300 rounded-lg px-3 py-2 transition-colors bg-white"
            >
              <RotateCcw size={13} />
              Reset
            </button>
          )}
        </div>

        {/* Two-column layout */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

          {/* Left — file + progress + validation */}
          <div className="lg:col-span-2 space-y-4">
            <SectionLabel step={1} label={t('onboarding.section_select_file', 'Select File')} />

            {!file ? (
              <DropZone
                onFileSelect={handleFileSelect}
                dragActive={dragActive}
                onDragChange={setDragActive}
              />
            ) : (
              <FileMetadata file={file} parsed={parsed} onRemove={handleRemove} />
            )}

            {/* Phase 1 — Parse progress */}
            {showParseProgress && (
              <ProgressCard
                label={t('onboarding.phase_parse', 'Parse')}
                sublabel={parseStats ? `${fmt(parseStats.validRows)} valid · ${fmt(parseStats.invalidRows)} invalid` : undefined}
                progress={parseProgress}
                status={status === 'error' && !showUploadProgress ? 'error' : status === 'success' ? 'success' : 'uploading'}
              >
                {parseStats && (
                  <StatRow>
                    <Stat label="Processed" value={fmt(parseStats.totalRows)} color="text-slate-600" />
                    <Stat label="Valid"      value={fmt(parseStats.validRows)}   color="text-emerald-600" />
                    {parseStats.invalidRows > 0 && (
                      <Stat label="Invalid" value={fmt(parseStats.invalidRows)} color="text-red-500" />
                    )}
                  </StatRow>
                )}
              </ProgressCard>
            )}

            {/* Phase 2 — Upload (chunk) progress */}
            {showUploadProgress && (
              <ProgressCard
                label={t('onboarding.phase_upload', 'Upload')}
                sublabel={uploadChunkStats
                  ? `Chunk ${uploadChunkStats.chunkIndex + 1} / ${uploadChunkStats.totalChunks}`
                  : undefined}
                progress={uploadProgress}
                status={status === 'error' ? 'error' : status === 'success' ? 'success' : 'uploading'}
              >
                {uploadChunkStats && (
                  <StatRow>
                    <Stat label={t('onboarding.stat_rows_uploaded', 'Rows uploaded')} value={fmt(uploadChunkStats.rowsUploaded)} color="text-slate-600" />
                    <Stat label="of"            value={fmt(uploadChunkStats.totalRows)}    color="text-slate-400" />
                  </StatRow>
                )}
              </ProgressCard>
            )}

            {/* Validation panel */}
            <SectionLabel step={null} label={t('onboarding.section_validation', 'Validation')} />
            <ValidationPanel messages={validationMsgs} />
          </div>

          {/* Right — mode + duplicate warning + submit */}
          <div className="space-y-4">
            <SectionLabel step={2} label={t('onboarding.section_upload_mode', 'Upload Mode')} />
            <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
              <UploadModeSelector
                value={uploadMode}
                onChange={setUploadMode}
                disabled={isWorking(status) || status === 'success'}
              />
            </div>

            {duplicateInfo && file && (
              <DuplicateWarning
                fileName={file.name}
                previousFileName={duplicateInfo.previousFileName}
                firstUploadedAt={duplicateInfo.firstUploadedAt}
                onDismiss={handleRemove}
                onContinue={() => void handleDuplicateContinue()}
              />
            )}

            <SectionLabel step={3} label={t('onboarding.section_submit', 'Submit')} />

            <button
              type="button"
              onClick={() => void handleUpload()}
              disabled={!canUpload}
              className={[
                'w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl',
                'font-sans font-semibold text-sm transition-all duration-150',
                canUpload
                  ? 'bg-ink text-parchment-50 hover:bg-ink-light shadow-sm active:scale-[0.98]'
                  : 'bg-slate-100 text-slate-400 cursor-not-allowed',
              ].join(' ')}
            >
              {buttonLabel()}
            </button>

            {file && status !== 'success' && (
              <p className="font-sans text-[11px] text-slate-400 text-center leading-relaxed">
                Mode: <span className="font-semibold text-slate-600 capitalize">{uploadMode}</span>
                {' · '}{file.name}
              </p>
            )}

            {/* ── Success banner ──────────────────────────────────────── */}
            {status === 'success' && parsed && (
              <div
                className="rounded-xl p-4 space-y-3"
                style={{
                  background:   'rgba(14,116,112,0.06)',
                  border:       '1px solid rgba(14,116,112,0.25)',
                  borderLeft:   '4px solid #0E7470',
                }}
              >
                <div className="flex items-start gap-2.5">
                  <RefreshCw size={14} className="shrink-0 mt-0.5" style={{ color: '#0E7470' }} />
                  <div className="min-w-0">
                    <p className="font-sans font-semibold text-xs" style={{ color: '#0E7470' }}>
                      {t('onboarding.status_success', 'Upload complete')}
                    </p>
                    <p className="font-sans text-[11px] mt-0.5" style={{ color: '#4A6E6B' }}>
                      {parsed.hotelName} · {parsed.hotelCode} · {parsed.module.toUpperCase()}
                      {parsed.countryCode ? ` (${parsed.countryCode})` : ''}
                    </p>
                  </div>
                </div>
                <Link
                  href={parsed.module.toLowerCase() === 'co'
                    ? `/dashboard?hotel=${encodeURIComponent(parsed.hotelCode)}&module=co${parsed.chainCode ? `&chain=${encodeURIComponent(parsed.chainCode)}` : ''}`
                    : `/dashboard?hotel=${encodeURIComponent(parsed.hotelCode)}&module=${encodeURIComponent(parsed.module.toLowerCase())}`}
                  className="flex items-center justify-center gap-2 w-full py-2.5 px-4 rounded-lg font-sans font-semibold text-xs transition-all duration-150 active:scale-[0.98]"
                  style={{
                    background: '#0E7470',
                    color:      '#F5F0E8',
                  }}
                >
                  {t('onboarding.button_view_dashboard', 'View Dashboard')}
                  <ArrowRight size={13} />
                </Link>
              </div>
            )}

            {/* Format reference card */}
            <div className="rounded-xl bg-slate-50 border border-slate-200 p-4 space-y-2.5">
              <p className="font-sans text-xs font-semibold text-slate-600">Required file name format</p>
              <code className="block font-mono text-[11px] text-slate-500 break-all leading-relaxed">
                [ChainCode]-[HotelCode]-[HotelName]-[Module]-[CountryCode]-[DataRange].csv
              </code>
              <p className="font-sans text-[11px] text-slate-500 leading-relaxed">
                Supported modules: <span className="font-semibold text-slate-700">IM</span> for incident data,{' '}
                <span className="font-semibold text-slate-700">JO</span> for job-order data, and{' '}
                <span className="font-semibold text-slate-700">MO</span> for maintenance CSVs containing MO and PM order numbers, and <span className="font-semibold text-slate-700">CO</span> for cleaning-order CSVs.
              </p>
              <div className="space-y-1">
                {[
                  ['ChainCode',   'e.g. Hyatt'],
                  ['HotelCode',   'e.g. TYOTY'],
                  ['HotelName',   'e.g. Hyatt Regency Tokyo'],
                  ['Module',      'IM, JO, MO, or CO'],
                  ['CountryCode', 'e.g. JP'],
                  ['DataRange',   'e.g. 4m or 2024Q1'],
                ].map(([seg, hint]) => (
                  <div key={seg} className="flex items-baseline gap-2">
                    <code className="font-mono text-[10px] text-gold-dark bg-amber-50 px-1.5 rounded shrink-0">{seg}</code>
                    <span className="font-sans text-[11px] text-slate-400">{hint}</span>
                  </div>
                ))}
              </div>
              <p className="font-sans text-[11px] text-slate-400 pt-1 border-t border-slate-200">
                Examples:{' '}
                <code className="font-mono text-slate-500">Hyatt-TYOTY-Hyatt Regency Tokyo-IM-JP-4m.csv</code>
                <br />
                <code className="font-mono text-slate-500">Hilton-WAM-Waldorf Astoria Maldives-MO-MV-1m.csv</code>
              </p>
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isWorking(status: UploadStatus): boolean {
  return status === 'hashing' || status === 'checking' || status === 'parsing' || status === 'uploading' || status === 'finalizing';
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionLabel({ step, label }: { step: number | null; label: string }) {
  return (
    <div className="flex items-center gap-2">
      {step !== null && (
        <span className="w-5 h-5 rounded-full bg-ink text-parchment-50 font-sans font-bold text-[10px] flex items-center justify-center shrink-0">
          {step}
        </span>
      )}
      <span className="text-[10px] font-sans font-semibold uppercase tracking-[0.18em] text-slate-400">
        {label}
      </span>
      <div className="flex-1 h-px bg-slate-200" />
    </div>
  );
}

function ProgressCard({
  label,
  sublabel,
  progress,
  status,
  children,
}: {
  label:     string;
  sublabel?: string;
  progress:  number;
  status:    'uploading' | 'success' | 'error';
  children?: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 px-4 py-4 shadow-sm space-y-3">
      <div className="flex items-center justify-between mb-1">
        <span className="font-sans text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
          {label}
        </span>
        {sublabel && (
          <span className="font-sans text-[11px] text-slate-400">{sublabel}</span>
        )}
      </div>
      <ProgressBar progress={progress} status={status} />
      {children}
    </div>
  );
}

function StatRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 pt-1 border-t border-slate-100">
      {children}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <span className={`font-sans text-xs ${color}`}>
      {label}: <strong className="tabular-nums">{value}</strong>
    </span>
  );
}
