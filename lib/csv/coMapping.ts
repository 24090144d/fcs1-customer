import type { CoRow } from '@/types/csv';

const CO_KEY_ALIASES: Record<string, string> = {
  created_date: 'created_date',
  created_datetime: 'created_date',
  cleaning_order_no: 'cleaning_order_no',
  cleaning_order_number: 'cleaning_order_no',
  cleaning_order: 'cleaning_order_no',
  order_no: 'cleaning_order_no',
  order_number: 'cleaning_order_no',
  room_no: 'room_no',
  room_number: 'room_no',
  room: 'room_no',
  location_name: 'room_no',
  room_type: 'room_type',
  location_category: 'room_type',
  floor: 'floor',
  building: 'building',
  status: 'status',
  status_code: 'status',
  priority: 'priority',
  stay_status: 'stay_status',
  stay_status_as_of_co_creation: 'stay_status',
  attendant: 'attendant',
  supervisor: 'supervisor',
  inspector: 'supervisor',
  department: 'department',
  task_type: 'task_type',
  service_round: 'task_type',
  cleaning_type: 'cleaning_type',
  clean_service_type: 'cleaning_type',
  start_time: 'start_time',
  end_time: 'end_time',
  complete_time: 'completed_time',
  completed_time: 'completed_time',
  duration_minutes: 'duration_minutes',
  time_spent: 'duration_minutes',
  cleaning_duration: 'planned_duration_minutes',
  cleaning_credit: 'cleaning_credit',
  ahead_behind: 'ahead_behind',
  inspection_status: 'inspection_status',
  pass_fail: 'pass_fail',
  reclean_flag: 'reclean_flag',
  additional_task_status: 'additional_task_status',
  remarks: 'remarks',
  comments: 'remarks',
  created_by: 'created_by',
  updated_by: 'updated_by',
  updated_on: 'updated_on',
  updated_date: 'updated_on',
};

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function canonicalCoKey(rawKey: string): string {
  const base = rawKey
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return CO_KEY_ALIASES[base] ?? base;
}

export function normaliseCoKeys(raw: Record<string, string | unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(raw).map(([key, value]) => [canonicalCoKey(key), value ?? ''])
  ) as Record<string, string>;
}

export function parseCoDateTime(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = collapseWhitespace(String(value));
  if (!text) return null;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function parseCoMinutes(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const text = collapseWhitespace(String(value));
  if (!text) return null;
  const hhmmss = text.match(/^(\d{1,3}):(\d{2})(?::(\d{2}))?$/);
  if (hhmmss) {
    const hours = Number(hhmmss[1]);
    const minutes = Number(hhmmss[2]);
    const seconds = Number(hhmmss[3] ?? 0);
    if ([hours, minutes, seconds].every(Number.isFinite)) {
      return hours * 60 + minutes + Math.floor(seconds / 60);
    }
  }
  const signed = text.match(/^([+-])\s*(\d{1,3}):(\d{2})(?::(\d{2}))?$/);
  if (signed) {
    const hours = Number(signed[2]);
    const minutes = Number(signed[3]);
    const seconds = Number(signed[4] ?? 0);
    const total = hours * 60 + minutes + Math.floor(seconds / 60);
    return signed[1] === '-' ? -total : total;
  }
  const numeric = Number(text);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = collapseWhitespace(String(value));
  return text ? text : null;
}

function normalizeUpperText(value: unknown): string | null {
  const text = normalizeText(value);
  return text ? text.toUpperCase() : null;
}

function normalizeRoomNo(value: unknown): string | null {
  const text = normalizeText(value);
  if (!text) return null;
  return text.replace(/\s+/g, ' ');
}

function normalizeAttendant(value: unknown): string | null {
  const text = normalizeText(value);
  if (!text) return null;
  return text.replace(/\s+/g, ' ');
}

function normalizePriority(value: unknown): string | null {
  const text = normalizeText(value);
  if (!text) return null;
  const upper = text.toUpperCase();
  if (/^(HIGH|P1|URGENT|A)$/i.test(upper)) return 'High';
  if (/^(MED|MEDIUM|P2|B)$/i.test(upper)) return 'Medium';
  if (/^(LOW|P3|C)$/i.test(upper)) return 'Low';
  return text;
}

function normalizeStatus(value: unknown): string | null {
  const text = normalizeText(value);
  if (!text) return null;
  const lower = text.toLowerCase();
  if (lower.includes('cancel')) return 'Cancelled';
  if (lower.includes('re-clean') || lower.includes('reclean')) return 'Re-clean Required';
  if (lower.includes('pass') || lower === 'ok') return 'Completed';
  if (lower.includes('fail')) return 'Needs Re-clean';
  if (lower.includes('complete') || lower.includes('done') || lower.includes('finish') || lower.includes('close')) return 'Completed';
  if (lower.includes('progress') || lower.includes('ongoing') || lower.includes('doing') || lower.includes('start')) return 'In Progress';
  if (lower.includes('hold') || lower.includes('wait')) return 'Pending';
  return text;
}

function normalizePassFail(value: unknown): string | null {
  const text = normalizeText(value);
  if (!text) return null;
  const lower = text.toLowerCase();
  if (lower.startsWith('p')) return 'Pass';
  if (lower.startsWith('f')) return 'Fail';
  return text;
}

function isTruthyLike(value: unknown): boolean {
  const text = normalizeText(value)?.toLowerCase() ?? '';
  return ['1', 'true', 'y', 'yes', 't', 'pass', 'passed', 'fail', 'failed', 'reclean', 're-clean'].includes(text);
}

function deriveCreatedDate(raw: Record<string, unknown>): string | null {
  return parseCoDateTime(raw.created_date ?? raw.start_time ?? raw.completed_time ?? raw.updated_on);
}

function deriveActualDurationMinutes(raw: Record<string, unknown>, startTime: string | null, completedTime: string | null): number | null {
  const direct = parseCoMinutes(raw.duration_minutes);
  if (direct !== null) return direct;
  const spent = parseCoMinutes(raw.time_spent);
  if (spent !== null) return spent;
  if (startTime && completedTime) {
    const start = new Date(startTime);
    const end = new Date(completedTime);
    if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())) {
      return Math.max(0, (end.getTime() - start.getTime()) / 60000);
    }
  }
  return null;
}

export function buildCoRow(raw: Record<string, string | unknown>, rowNumber: number): CoRow {
  const norm = normaliseCoKeys(raw);
  const cleaningOrderNo = normalizeText(norm.cleaning_order_no) ?? `CO-${String(rowNumber).padStart(4, '0')}`;
  const roomNo = normalizeRoomNo(norm.room_no);
  const roomType = normalizeText(norm.room_type);
  const floor = normalizeUpperText(norm.floor);
  const building = normalizeText(norm.building);
  const statusRaw = normalizeText(norm.status);
  const priority = normalizePriority(norm.priority);
  const stayStatus = normalizeText(norm.stay_status);
  const attendant = normalizeAttendant(norm.attendant);
  const supervisor = normalizeAttendant(norm.supervisor);
  const department = normalizeText(norm.department);
  const taskType = normalizeText(norm.task_type);
  const cleaningType = normalizeText(norm.cleaning_type);
  const startTime = parseCoDateTime(norm.start_time);
  const endTime = parseCoDateTime(norm.end_time);
  const completedTime = parseCoDateTime(norm.completed_time);
  const createdDate = deriveCreatedDate(norm);
  const updatedOn = parseCoDateTime(norm.updated_on);
  const plannedDurationMinutes = parseCoMinutes(norm.planned_duration_minutes ?? norm.cleaning_duration);
  const actualDurationMinutes = deriveActualDurationMinutes(norm, startTime, completedTime);
  const durationMinutes = actualDurationMinutes ?? plannedDurationMinutes;
  const aheadBehindMinutes = parseCoMinutes(norm.ahead_behind);
  const cleaningCredit = parseCoMinutes(norm.cleaning_credit);
  const passFail = normalizePassFail(norm.pass_fail);
  const inspectionStatus = normalizeText(norm.inspection_status) ?? passFail;
  const additionalTaskStatus = normalizeText(norm.additional_task_status);
  const recleanFlag = isTruthyLike(norm.reclean_flag)
    || (passFail === 'Fail')
    || (additionalTaskStatus !== null && additionalTaskStatus.length > 0 && !/^none$/i.test(additionalTaskStatus))
    || /re[- ]?clean/i.test(norm.remarks ?? '');
  const statusNormalized = normalizeStatus(statusRaw)
    ?? (passFail === 'Fail' ? 'Needs Re-clean' : passFail === 'Pass' ? 'Completed' : null)
    ?? (completedTime ? 'Completed' : startTime ? 'In Progress' : 'Pending');
  const isCompleted = statusNormalized === 'Completed';
  const isOnTime = typeof actualDurationMinutes === 'number' && typeof plannedDurationMinutes === 'number'
    ? actualDurationMinutes <= plannedDurationMinutes
    : aheadBehindMinutes !== null
      ? aheadBehindMinutes <= 0
      : isCompleted;
  const productivityPerHour = typeof cleaningCredit === 'number' && typeof actualDurationMinutes === 'number' && actualDurationMinutes > 0
    ? Number(((cleaningCredit / actualDurationMinutes) * 60).toFixed(2))
    : null;
  const durationVarianceMinutes = typeof actualDurationMinutes === 'number' && typeof plannedDurationMinutes === 'number'
    ? Number((actualDurationMinutes - plannedDurationMinutes).toFixed(2))
    : aheadBehindMinutes !== null
      ? Number((-aheadBehindMinutes).toFixed(2))
      : null;

  return {
    row_key: `${cleaningOrderNo}::${roomNo ?? ''}::${startTime ?? completedTime ?? createdDate ?? rowNumber}`,
    row_number: rowNumber,
    report_variant: 'ACSR',
    created_date: createdDate,
    cleaning_order_no: cleaningOrderNo,
    room_no: roomNo,
    room_type: roomType,
    floor,
    building,
    status: statusRaw,
    status_normalized: statusNormalized,
    priority,
    priority_normalized: priority,
    stay_status: stayStatus,
    attendant,
    supervisor,
    department,
    task_type: taskType,
    cleaning_type: cleaningType,
    start_time: startTime,
    end_time: endTime,
    completed_time: completedTime,
    duration_minutes: durationMinutes,
    planned_duration_minutes: plannedDurationMinutes,
    actual_duration_minutes: actualDurationMinutes,
    duration_variance_minutes: durationVarianceMinutes,
    ahead_behind_minutes: aheadBehindMinutes,
    inspection_status: inspectionStatus,
    pass_fail: passFail,
    is_passed: passFail === 'Pass',
    reclean_flag: recleanFlag,
    remarks: normalizeText(norm.remarks),
    created_by: normalizeText(norm.created_by),
    updated_by: normalizeText(norm.updated_by),
    updated_on: updatedOn,
    cleaning_credit: cleaningCredit,
    productivity_per_hour: productivityPerHour,
    is_completed: isCompleted,
    is_on_time: isOnTime,
    additional_task_status: additionalTaskStatus,
  };
}
