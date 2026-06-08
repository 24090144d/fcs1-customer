// ── Constants ─────────────────────────────────────────────────────────────────

export const CHUNK_THRESHOLD_BYTES = 10 * 1024 * 1024;   // 10 MB  → use chunk mode above this
export const MAX_FILE_BYTES        = 50 * 1024 * 1024;   // 50 MB  → hard reject above this
export const MAX_ERRORS_COLLECTED  = 100;                 // cap collected validation errors
export const PROGRESS_THROTTLE_MS  = 100;                 // min ms between progress UI updates

// ── Module ────────────────────────────────────────────────────────────────────

export type ModuleCode = 'IM' | 'JO' | 'MO' | 'CO';

// ── Progress ──────────────────────────────────────────────────────────────────

export type ParsePhase = 'idle' | 'reading' | 'parsing' | 'complete' | 'error';

export interface ParseProgress {
  phase:          ParsePhase;
  bytesProcessed: number;
  totalBytes:     number;
  rowsProcessed:  number;
  validRows:      number;
  invalidRows:    number;
  pct:            number;        // 0–100
  errorMessage?:  string;
}

// ── Validation ────────────────────────────────────────────────────────────────

export interface ValidationError {
  rowNumber: number;
  field:     string;
  value:     unknown;
  message:   string;
}

// ── Row shapes ────────────────────────────────────────────────────────────────

/** Incident Management row — mirrors im_records table columns (all 40 CSV fields) */
export interface ImRow {
  row_key:    string;   // duplicate-detection key
  row_number: number;   // 1-based position in file
  // Identity
  incident_case:        string;
  incident_status:      string;
  incident_category:    string;
  incident_item_name:   string | null;
  incident_description: string | null;
  incident_location:    string | null;
  severity:             string | null;
  subject:              string | null;
  source_of_complaint:  string | null;
  // Dates
  created_date:         string | null;
  incident_datetime:    string | null;
  // Guest profile
  guest_name:           string | null;
  room_no:              string | null;
  profile_type:         string | null;
  vip_code:             string | null;
  membership_number:    string | null;
  reservation_number:   string | null;
  date_of_birth:        string | null;
  company_name:         string | null;
  // Stay details
  arrival_date:         string | null;
  departure_date:       string | null;
  nights:               number | null;
  rates:                string | null;
  rate_code:            string | null;
  booking_source:       string | null;
  visits:               string | null;
  // Staff
  created_by:           string | null;
  department:           string | null;
  // Investigation cycle 1
  investigation_1:            string | null;
  investigation_remarks_1:    string | null;
  investigation_updated_by_1: string | null;
  investigation_updated_on_1: string | null;
  // Investigation cycle 2
  investigation_2:            string | null;
  investigation_remarks_2:    string | null;
  investigation_updated_by_2: string | null;
  investigation_updated_on_2: string | null;
  // Feedback cycle 1
  feedback_method_1:      string | null;
  feedback_updated_by_1:  string | null;
  feedback_updated_on_1:  string | null;
  feedback_remarks_1:     string | null;
}

/** Job Orders row — mirrors jo_records table columns */
export interface JoRow {
  row_key:               string;
  row_number:            number;
  department_name:       string | null;
  created_datetime:      string | null;
  job_status:            string;
  job_order:             string;
  guest_name:            string | null;
  location:              string | null;
  service_item_category: string | null;
  service_item:          string | null;
  quantity:              number | null;
  remarks:               string | null;
  execution_duration:    string | null;
  initial_deadline:      string | null;
  extended_deadline:     string | null;
  acknowledged_datetime: string | null;
  completed_datetime:    string | null;
  delay_duration:        string | null;
  created_by_department: string | null;
  created_by_user:       string | null;
  assigned_to_department: string | null;
  assigned_to_user:      string | null;
  acknowledged_by_department: string | null;
  acknowledged_by_user:  string | null;
  completed_by_department: string | null;
  completed_by_user:     string | null;
  total_minute_between_created_to_completed: string | null;
  total_act_between_acknowledged_to_completed: string | null;
  comments:              string | null;
  attachment:            string | null;
  reassigned_job:        string | null;
  escalation_group:      string | null;
  vip_code:              string | null;
  is_vip:                boolean;
  actual_duration:       number | null;
  is_ontime:             boolean;
  is_complete:           boolean;
}

/** Maintenance Orders CSV row — mirrors the 34 source MO/PM upload columns */
export interface MoCsvRow {
  'Date&Time (Created)': string;
  'Job Status': string;
  'Job Order': string;
  'Guest Name': string;
  Location: string;
  Category: string;
  Defect: string;
  Remarks: string;
  'Date&Time (Deadline)': string;
  'Date&Time (Completed)': string;
  'Escalation Level': string;
  'Escalation To': string;
  Building: string;
  Floor: string;
  Asset: string;
  'Created By': string;
  'Created By (Dept)': string;
  'Assigned To': string;
  'Completed By': string;
  'Inspected By': string;
  Attachment: string;
  'Checklist Name': string;
  'Checklist Status': string;
  'Stock Out By': string;
  'Stock Out Qty': string;
  'Inventory Item': string;
  Comment: string;
  'Remarks in Proof of Completion': string;
  eSignature: string;
  'Inspection Remark': string;
  'Inspection Result': string;
  'Guest Related': string;
  'Cancel Reason': string;
  'Stop Reason': string;
}

/** Maintenance Orders parsed row — normalized to app/database field names */
export interface MoRow {
  row_key: string;
  row_number: number;
  created_datetime: string | null;
  job_status: string;
  job_order: string;
  guest_name: string | null;
  location: string | null;
  category: string | null;
  defect: string | null;
  remarks: string | null;
  deadline_datetime: string | null;
  completed_datetime: string | null;
  escalation_level: string | null;
  escalation_to: string | null;
  building: string | null;
  floor: string | null;
  asset: string | null;
  created_by: string | null;
  created_by_department: string | null;
  assigned_to: string | null;
  completed_by: string | null;
  inspected_by: string | null;
  attachment: string | null;
  checklist_name: string | null;
  checklist_status: string | null;
  stock_out_by: string | null;
  stock_out_qty: string | null;
  inventory_item: string | null;
  comment: string | null;
  remarks_proof_of_completion: string | null;
  e_signature: string | null;
  inspection_remark: string | null;
  inspection_result: string | null;
  guest_related: string | null;
  cancel_reason: string | null;
  stop_reason: string | null;
}

/** Cleaning Order ACSR row — normalized across sparse CO CSV templates */
export interface CoRow {
  row_key: string;
  row_number: number;
  report_variant: 'ACSR';
  chain_code?: string | null;
  hotel_code?: string | null;
  created_date: string | null;
  cleaning_order_no: string;
  room_no: string | null;
  room_type: string | null;
  floor: string | null;
  building: string | null;
  status: string | null;
  status_normalized: string;
  priority: string | null;
  priority_normalized: string | null;
  stay_status: string | null;
  attendant: string | null;
  supervisor: string | null;
  department: string | null;
  task_type: string | null;
  cleaning_type: string | null;
  start_time: string | null;
  end_time: string | null;
  completed_time: string | null;
  duration_minutes: number | null;
  planned_duration_minutes: number | null;
  actual_duration_minutes: number | null;
  duration_variance_minutes: number | null;
  ahead_behind_minutes: number | null;
  inspection_status: string | null;
  pass_fail: string | null;
  is_passed: boolean;
  reclean_flag: boolean;
  remarks: string | null;
  created_by: string | null;
  updated_by: string | null;
  updated_on: string | null;
  cleaning_credit: number | null;
  productivity_per_hour: number | null;
  is_completed: boolean;
  is_on_time: boolean;
  additional_task_status: string | null;
}

export type ParsedRow = ImRow | JoRow | MoRow | CoRow;

// ── Parse result ──────────────────────────────────────────────────────────────

export interface ParseResult {
  module:      ModuleCode;
  totalRows:   number;
  validRows:   number;
  invalidRows: number;
  errors:      ValidationError[];   // max MAX_ERRORS_COLLECTED
  durationMs:  number;
}

// ── Parser config ─────────────────────────────────────────────────────────────

export interface CsvParseConfig {
  module:         ModuleCode;
  /** Use PapaParse's built-in Web Worker (experimental — may need Next.js config) */
  useWorker?:     boolean;
  /** Called at most every PROGRESS_THROTTLE_MS ms */
  onProgress?:    (p: ParseProgress) => void;
  /** Called once per valid row — do NOT accumulate in memory for large files */
  onValidRow?:    (row: ParsedRow, rowNumber: number) => void;
  /** Called for every invalid row */
  onInvalidRow?:  (raw: Record<string, string>, errors: ValidationError[]) => void;
  /** Called once when all rows have been processed */
  onComplete?:    (result: ParseResult) => void;
  /** Called on fatal parse / file errors */
  onError?:       (message: string) => void;
}

// ── Worker message protocol ───────────────────────────────────────────────────

export interface WorkerRequest {
  type:   'START';
  module: ModuleCode;
  // File is transferred as ArrayBuffer because File can't cross worker boundary
  buffer: ArrayBuffer;
  name:   string;
  size:   number;
}

export type WorkerResponse =
  | { type: 'PROGRESS'; data: ParseProgress }
  | { type: 'VALID_ROW'; row: ParsedRow; rowNumber: number }
  | { type: 'INVALID_ROW'; raw: Record<string, string>; errors: ValidationError[] }
  | { type: 'COMPLETE'; result: ParseResult }
  | { type: 'ERROR'; message: string };
