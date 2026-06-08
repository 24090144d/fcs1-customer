import { z } from 'zod';
import type { ModuleCode, ImRow, JoRow, MoRow, CoRow, ValidationError } from '@/types/csv';
import { buildCoRow } from '@/lib/csv/coMapping';

// ── Required column lists ─────────────────────────────────────────────────────

export const IM_REQUIRED_COLUMNS = [
  'incident_case',
  'incident_status',
  'created_date',
] as const;

export const JO_REQUIRED_COLUMNS = [
  'job_order',
  'job_status',
  'created_datetime',
] as const;

export const MO_REQUIRED_COLUMNS = [
  'job_order',
  'job_status',
  'created_datetime',
] as const;

export const CO_REQUIRED_COLUMNS = [] as const;

// ── Zod primitives ────────────────────────────────────────────────────────────

/** Optional nullable string — empty string collapses to null */
const optStr = z
  .string()
  .trim()
  .optional()
  .nullable()
  .transform((v) => (v && v.length > 0 ? v : null));

/** Required non-empty string */
const reqStr = z.string().trim().min(1, 'Required — must not be empty');

/** Optional numeric string → number | null */
const optNum = z
  .string()
  .trim()
  .optional()
  .nullable()
  .transform((v) => {
    if (!v || v.length === 0) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  });

// ── IM Zod schema ─────────────────────────────────────────────────────────────

export const ImRowSchema = z.object({
  // ── Required identity ─────────────────────────────────────────────────────
  incident_case:      reqStr,
  incident_status:    reqStr,
  incident_category:  z.string().trim().default(''),
  incident_item_name: optStr,
  incident_description: optStr,
  incident_location:  optStr,
  severity:           optStr,
  subject:            optStr,
  source_of_complaint: optStr,
  // ── Dates ─────────────────────────────────────────────────────────────────
  created_date:       optStr,
  incident_datetime:  optStr,   // aliased from "Incident Date/Time"
  // ── Guest profile ─────────────────────────────────────────────────────────
  guest_name:         optStr,
  room_no:            optStr,
  profile_type:       optStr,
  vip_code:           optStr,
  membership_number:  optStr,
  reservation_number: optStr,
  date_of_birth:      optStr,
  company_name:       optStr,
  // ── Stay details ──────────────────────────────────────────────────────────
  arrival_date:       optStr,   // aliased from "Arrival"
  departure_date:     optStr,   // aliased from "Departure"
  nights:             optNum,
  rates:              optStr,
  rate_code:          optStr,
  booking_source:     optStr,
  visits:             optStr,
  // ── Staff ─────────────────────────────────────────────────────────────────
  created_by:         optStr,
  department:         optStr,
  // ── Investigation cycle 1 ─────────────────────────────────────────────────
  investigation_1:            optStr,  // aliased from "Investigation/Follow Up 1"
  investigation_remarks_1:    optStr,
  investigation_updated_by_1: optStr,
  investigation_updated_on_1: optStr,
  // ── Investigation cycle 2 ─────────────────────────────────────────────────
  investigation_2:            optStr,  // aliased from "Investigation/Follow Up 2"
  investigation_remarks_2:    optStr,
  investigation_updated_by_2: optStr,
  investigation_updated_on_2: optStr,
  // ── Feedback cycle 1 ──────────────────────────────────────────────────────
  feedback_method_1:      optStr,
  feedback_updated_by_1:  optStr,
  feedback_updated_on_1:  optStr,
  feedback_remarks_1:     optStr,
});

// ── JO Zod schema ─────────────────────────────────────────────────────────────

export const JoRowSchema = z.object({
  job_order:             reqStr,
  job_status:            reqStr,
  department_name:       optStr,
  created_datetime:      optStr,
  guest_name:            optStr,
  location:              optStr,
  service_item_category: optStr,
  service_item:          optStr,
  quantity:              optNum,
  remarks:               optStr,
  execution_duration:    optStr,
  initial_deadline:      optStr,
  extended_deadline:     optStr,
  acknowledged_datetime: optStr,
  completed_datetime:    optStr,
  delay_duration:        optStr,
  created_by_department: optStr,
  created_by_user:       optStr,
  assigned_to_department: optStr,
  assigned_to_user:      optStr,
  acknowledged_by_department: optStr,
  acknowledged_by_user:  optStr,
  completed_by_department: optStr,
  completed_by_user:     optStr,
  total_hour_between_created_to_completed: optStr,
  total_act_between_acknowledged_to_completed: optStr,
  comments:              optStr,
  attachment:            optStr,
  reassigned_job:        optStr,
  escalation_group:      optStr,
  vip_code:              optStr,
});

// ── MO Zod schema ─────────────────────────────────────────────────────────────

export const MoRowSchema = z.object({
  created_datetime:      reqStr,
  job_status:            reqStr,
  job_order:             reqStr,
  guest_name:            optStr,
  location:              optStr,
  category:              optStr,
  defect:                optStr,
  remarks:               optStr,
  deadline_datetime:     optStr,
  completed_datetime:    optStr,
  escalation_level:      optStr,
  escalation_to:         optStr,
  building:              optStr,
  floor:                 optStr,
  asset:                 optStr,
  created_by:            optStr,
  created_by_department: optStr,
  assigned_to:           optStr,
  completed_by:          optStr,
  inspected_by:          optStr,
  attachment:            optStr,
  checklist_name:        optStr,
  checklist_status:      optStr,
  stock_out_by:          optStr,
  stock_out_qty:         optStr,
  inventory_item:        optStr,
  comment:               optStr,
  remarks_proof_of_completion: optStr,
  e_signature:           optStr,
  inspection_remark:     optStr,
  inspection_result:     optStr,
  guest_related:         optStr,
  cancel_reason:         optStr,
  stop_reason:           optStr,
});

// ── Key normalisation ─────────────────────────────────────────────────────────

/**
 * CSV header → canonical snake_case key.
 * Handles columns whose raw header doesn't cleanly convert via space→underscore:
 *  - "Arrival" / "Departure" → arrival_date / departure_date
 *  - "Incident Date/Time"    → incident_datetime  (slash stripped)
 *  - "Investigation/Follow Up N" → investigation_N
 */
const IM_KEY_ALIASES: Record<string, string> = {
  arrival:                   'arrival_date',
  departure:                 'departure_date',
  incident_date_time:        'incident_datetime',
  investigation_follow_up_1: 'investigation_1',
  investigation_follow_up_2: 'investigation_2',
};

const JO_KEY_ALIASES: Record<string, string> = {
  created_date_time: 'created_datetime',
  job_acknowledged_date_time: 'acknowledged_datetime',
  job_completed_date_time: 'completed_datetime',
  vip: 'vip_code',   // CSV header "VIP" → canonical field "vip_code"
};

const MO_KEY_ALIASES: Record<string, string> = {
  date_time_created: 'created_datetime',
  date_time_deadline: 'deadline_datetime',
  date_time_completed: 'completed_datetime',
  created_by_dept: 'created_by_department',
  remarks_in_proof_of_completion: 'remarks_proof_of_completion',
  esignature: 'e_signature',
};

function canonicalKey(rawKey: string): string {
  const base = rawKey
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  const imAliased = IM_KEY_ALIASES[base] ?? base;
  const joAliased = JO_KEY_ALIASES[imAliased] ?? imAliased;
  return MO_KEY_ALIASES[joAliased] ?? joAliased;
}

/**
 * Normalise raw PapaParse headers/keys:
 * trim whitespace, lowercase, collapse inner spaces to underscore,
 * then apply IM_KEY_ALIASES for headers that don't map 1-to-1.
 * e.g. "VIP Code" → "vip_code", "Incident Date/Time" → "incident_datetime"
 */
function normaliseKeys(raw: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(raw).map(([k, v]) => {
      return [canonicalKey(k), v ?? ''];
    })
  );
}

// ── Row-key generators (deterministic, for duplicate detection) ───────────────

function makeImKey(d: z.infer<typeof ImRowSchema>): string {
  return `IM::${d.incident_case}::${d.created_date ?? ''}`;
}

function makeJoKey(d: z.infer<typeof JoRowSchema>): string {
  return `JO::${d.job_order}::${d.created_datetime ?? ''}`;
}

function makeMoKey(d: z.infer<typeof MoRowSchema>): string {
  return `MO::${d.job_order}::${d.created_datetime ?? ''}`;
}

// ── Per-row validators ────────────────────────────────────────────────────────

export function validateImRow(
  raw: Record<string, string>,
  rowNumber: number,
): { row: ImRow | null; errors: ValidationError[] } {
  const norm   = normaliseKeys(raw);
  const result = ImRowSchema.safeParse(norm);

  if (!result.success) {
    return {
      row: null,
      errors: result.error.issues.map((issue) => ({
        rowNumber,
        field:   String(issue.path[0] ?? 'unknown'),
        value:   norm[String(issue.path[0])] ?? '',
        message: issue.message,
      })),
    };
  }

  const d = result.data;
  return {
    row: {
      row_key:            makeImKey(d),
      row_number:         rowNumber,
      // Identity
      incident_case:        d.incident_case,
      incident_status:      d.incident_status,
      incident_category:    d.incident_category,
      incident_item_name:   d.incident_item_name   ?? null,
      incident_description: d.incident_description ?? null,
      incident_location:    d.incident_location    ?? null,
      severity:             d.severity             ?? null,
      subject:              d.subject              ?? null,
      source_of_complaint:  d.source_of_complaint  ?? null,
      // Dates
      created_date:         d.created_date         ?? null,
      incident_datetime:    d.incident_datetime    ?? null,
      // Guest profile
      guest_name:           d.guest_name           ?? null,
      room_no:              d.room_no              ?? null,
      profile_type:         d.profile_type         ?? null,
      vip_code:             d.vip_code             ?? null,
      membership_number:    d.membership_number    ?? null,
      reservation_number:   d.reservation_number   ?? null,
      date_of_birth:        d.date_of_birth        ?? null,
      company_name:         d.company_name         ?? null,
      // Stay details
      arrival_date:         d.arrival_date         ?? null,
      departure_date:       d.departure_date       ?? null,
      nights:               d.nights               ?? null,
      rates:                d.rates                ?? null,
      rate_code:            d.rate_code            ?? null,
      booking_source:       d.booking_source       ?? null,
      visits:               d.visits               ?? null,
      // Staff
      created_by:           d.created_by           ?? null,
      department:           d.department           ?? null,
      // Investigation cycle 1
      investigation_1:            d.investigation_1            ?? null,
      investigation_remarks_1:    d.investigation_remarks_1    ?? null,
      investigation_updated_by_1: d.investigation_updated_by_1 ?? null,
      investigation_updated_on_1: d.investigation_updated_on_1 ?? null,
      // Investigation cycle 2
      investigation_2:            d.investigation_2            ?? null,
      investigation_remarks_2:    d.investigation_remarks_2    ?? null,
      investigation_updated_by_2: d.investigation_updated_by_2 ?? null,
      investigation_updated_on_2: d.investigation_updated_on_2 ?? null,
      // Feedback cycle 1
      feedback_method_1:      d.feedback_method_1      ?? null,
      feedback_updated_by_1:  d.feedback_updated_by_1  ?? null,
      feedback_updated_on_1:  d.feedback_updated_on_1  ?? null,
      feedback_remarks_1:     d.feedback_remarks_1     ?? null,
    },
    errors: [],
  };
}

export function validateJoRow(
  raw: Record<string, string>,
  rowNumber: number,
): { row: JoRow | null; errors: ValidationError[] } {
  const norm   = normaliseKeys(raw);
  const result = JoRowSchema.safeParse(norm);

  if (!result.success) {
    return {
      row: null,
      errors: result.error.issues.map((issue) => ({
        rowNumber,
        field:   String(issue.path[0] ?? 'unknown'),
        value:   norm[String(issue.path[0])] ?? '',
        message: issue.message,
      })),
    };
  }

  const d = result.data;
  return {
    row: {
      row_key:               makeJoKey(d),
      row_number:            rowNumber,
      department_name:       d.department_name       ?? null,
      created_datetime:      d.created_datetime      ?? null,
      job_status:            d.job_status,
      job_order:             d.job_order,
      guest_name:            d.guest_name            ?? null,
      location:              d.location              ?? null,
      service_item_category: d.service_item_category ?? null,
      service_item:          d.service_item          ?? null,
      quantity:              d.quantity              ?? null,
      remarks:               d.remarks               ?? null,
      execution_duration:    d.execution_duration    ?? null,
      initial_deadline:      d.initial_deadline      ?? null,
      extended_deadline:     d.extended_deadline     ?? null,
      acknowledged_datetime: d.acknowledged_datetime ?? null,
      completed_datetime:    d.completed_datetime    ?? null,
      delay_duration:        d.delay_duration        ?? null,
      created_by_department: d.created_by_department ?? null,
      created_by_user:       d.created_by_user       ?? null,
      assigned_to_department: d.assigned_to_department ?? null,
      assigned_to_user:      d.assigned_to_user      ?? null,
      acknowledged_by_department: d.acknowledged_by_department ?? null,
      acknowledged_by_user:  d.acknowledged_by_user  ?? null,
      completed_by_department: d.completed_by_department ?? null,
      completed_by_user:     d.completed_by_user     ?? null,
      total_hour_between_created_to_completed: d.total_hour_between_created_to_completed ?? null,
      total_act_between_acknowledged_to_completed: d.total_act_between_acknowledged_to_completed ?? null,
      comments:              d.comments              ?? null,
      attachment:            d.attachment            ?? null,
      reassigned_job:        d.reassigned_job        ?? null,
      escalation_group:      d.escalation_group      ?? null,
      vip_code:              d.vip_code              ?? null,
      is_vip: (() => {
        const code = (d.vip_code ?? '').trim();
        return code !== '' && code !== '-' && code !== '0';
      })(),
      // Derived: parse "HH:MM" (or plain number) → total minutes
      actual_duration: (() => {
        const raw = (d.total_hour_between_created_to_completed ?? '').trim();
        if (!raw) return null;
        const parts = raw.split(':');
        if (parts.length >= 2) {
          const h = parseInt(parts[0], 10) || 0;
          const m = parseInt(parts[1], 10) || 0;
          return h * 60 + m;
        }
        const n = parseFloat(raw);
        return Number.isFinite(n) && n >= 0 ? n : null;
      })(),
      // On-time: delay is null / empty / all-zeros (e.g. '00:00')
      is_ontime: (() => {
        const s = (d.delay_duration ?? '').trim();
        return !s || s === '0' || /^[0:]+$/.test(s);
      })(),
      is_complete: d.job_status === 'Completed',
    },
    errors: [],
  };
}

export function validateMoRow(
  raw: Record<string, string>,
  rowNumber: number,
): { row: MoRow | null; errors: ValidationError[] } {
  const norm   = normaliseKeys(raw);
  const result = MoRowSchema.safeParse(norm);

  if (!result.success) {
    return {
      row: null,
      errors: result.error.issues.map((issue) => ({
        rowNumber,
        field:   String(issue.path[0] ?? 'unknown'),
        value:   norm[String(issue.path[0])] ?? '',
        message: issue.message,
      })),
    };
  }

  const d = result.data;
  return {
    row: {
      row_key:               makeMoKey(d),
      row_number:            rowNumber,
      created_datetime:      d.created_datetime,
      job_status:            d.job_status,
      job_order:             d.job_order,
      guest_name:            d.guest_name ?? null,
      location:              d.location ?? null,
      category:              d.category ?? null,
      defect:                d.defect ?? null,
      remarks:               d.remarks ?? null,
      deadline_datetime:     d.deadline_datetime ?? null,
      completed_datetime:    d.completed_datetime ?? null,
      escalation_level:      d.escalation_level ?? null,
      escalation_to:         d.escalation_to ?? null,
      building:              d.building ?? null,
      floor:                 d.floor ?? null,
      asset:                 d.asset ?? null,
      created_by:            d.created_by ?? null,
      created_by_department: d.created_by_department ?? null,
      assigned_to:           d.assigned_to ?? null,
      completed_by:          d.completed_by ?? null,
      inspected_by:          d.inspected_by ?? null,
      attachment:            d.attachment ?? null,
      checklist_name:        d.checklist_name ?? null,
      checklist_status:      d.checklist_status ?? null,
      stock_out_by:          d.stock_out_by ?? null,
      stock_out_qty:         d.stock_out_qty ?? null,
      inventory_item:        d.inventory_item ?? null,
      comment:               d.comment ?? null,
      remarks_proof_of_completion: d.remarks_proof_of_completion ?? null,
      e_signature:           d.e_signature ?? null,
      inspection_remark:     d.inspection_remark ?? null,
      inspection_result:     d.inspection_result ?? null,
      guest_related:         d.guest_related ?? null,
      cancel_reason:         d.cancel_reason ?? null,
      stop_reason:           d.stop_reason ?? null,
    },
    errors: [],
  };
}

export function validateCoRow(
  raw: Record<string, string>,
  rowNumber: number,
): { row: CoRow | null; errors: ValidationError[] } {
  return {
    row: buildCoRow(raw, rowNumber),
    errors: [],
  };
}

// ── Header validation ─────────────────────────────────────────────────────────

/**
 * Check that all required columns for the module are present in the CSV header.
 * Header matching is case-insensitive and space-tolerant.
 */
export function validateHeaders(
  headers: string[],
  module: ModuleCode,
): { ok: boolean; missing: string[] } {
  const normalised = headers.map(canonicalKey);
  const required =
    module === 'IM' ? IM_REQUIRED_COLUMNS
      : module === 'JO' ? JO_REQUIRED_COLUMNS
      : module === 'MO' ? MO_REQUIRED_COLUMNS
      : CO_REQUIRED_COLUMNS;
  const missing = required.filter((col) => !normalised.includes(col));
  return { ok: missing.length === 0, missing };
}
