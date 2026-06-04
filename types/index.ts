// Shared TypeScript types for the Incident Analytics Dashboard

// ── Supabase database type scaffold ──────────────────────────────────────────
// Replace with generated types from: `npx supabase gen types typescript`
export type Database = {
  public: {
    Tables: {
      incidents: {
        Row:           IncidentRecord;
        Insert:        IncidentInsert;
        Update:        Partial<IncidentInsert>;
        Relationships: never[];
      };
      organizations: {
        Row:           { id: string; organization_code: string; organization_name: string; timezone: string; metadata: Record<string, unknown>; created_by: string | null; created_at: string; updated_at: string };
        Insert:        { id?: string; organization_code: string; organization_name: string; timezone?: string; metadata?: Record<string, unknown>; created_by?: string | null; created_at?: string; updated_at?: string };
        Update:        Partial<{ organization_code: string; organization_name: string; timezone: string; metadata: Record<string, unknown> }>;
        Relationships: never[];
      };
      upload_jobs: {
        Row:           UploadJobRow;
        Insert:        UploadJobInsert;
        Update:        Partial<UploadJobInsert>;
        Relationships: never[];
      };
      uploaded_files: {
        Row:           UploadedFileRow;
        Insert:        UploadedFileInsert;
        Update:        Partial<UploadedFileInsert>;
        Relationships: never[];
      };
    };
    Views:          { [_ in never]: never };
    Functions:      { [_ in never]: never };
    Enums:          { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};

// ── Incident domain types ─────────────────────────────────────────────────────

export type Severity = "Critical" | "High" | "Medium" | "Low" | "Info";
export type IncidentStatus = "Open" | "In Progress" | "Resolved" | "Closed";

export interface IncidentRecord {
  id:           string;
  incident_id:  string;
  title:        string;
  severity:     Severity;
  status:       IncidentStatus;
  category:     string | null;
  assignee:     string | null;
  created_at:   string;
  resolved_at:  string | null;
  sla_breached: boolean;
  uploaded_by:  string;
  upload_batch: string;
  inserted_at:  string;
}

export type IncidentInsert = Omit<IncidentRecord, "id" | "inserted_at">;

// ── Upload job types ──────────────────────────────────────────────────────────

export type UploadJobStatus = 'pending' | 'processing' | 'completed' | 'failed';
export type UploadMode      = 'replace' | 'append'    | 'upsert';
export type ModuleCodeDb    = 'im'      | 'jo'      | 'mo';

export interface UploadJobRow {
  id:              string;
  organization_id: string;
  status:          UploadJobStatus;
  module_code:     ModuleCodeDb;
  source_name:     string | null;
  requested_by:    string | null;
  started_at:      string | null;
  completed_at:    string | null;
  failed_reason:   string | null;
  total_files:     number;
  total_rows:      number;
  processed_rows:  number;
  created_at:      string;
  updated_at:      string;
}

export type UploadJobInsert = Omit<UploadJobRow, 'id' | 'created_at' | 'updated_at'>;

// ── Uploaded file types ───────────────────────────────────────────────────────

export interface UploadedFileRow {
  id:              string;
  organization_id: string;
  upload_job_id:   string;
  file_name:       string;
  mime_type:       string | null;
  file_size_bytes: number | null;
  file_hash:       string;
  storage_bucket:  string | null;
  storage_path:    string | null;
  uploaded_by:     string | null;
  uploaded_at:     string;
  created_at:      string;
  updated_at:      string;
  module_code:     ModuleCodeDb;
}

export type UploadedFileInsert = Omit<UploadedFileRow, 'id' | 'uploaded_at' | 'created_at' | 'updated_at'>;

// ── Dashboard / chart types ───────────────────────────────────────────────────

export interface KpiSummary {
  total:        number;
  open:         number;
  inProgress:   number;
  resolved:     number;
  slaBreached:  number;
  avgMttrHours: number | null;
}

export interface TimeSeriesPoint {
  date:  string;
  count: number;
}

export interface SeverityBreakdown {
  severity: Severity;
  count:    number;
}

export interface StatusBreakdown {
  status: IncidentStatus;
  count:  number;
}

// ── Upload result (legacy) ────────────────────────────────────────────────────

export interface UploadResult {
  batchId:    string;
  inserted:   number;
  skipped:    number;
  errors:     string[];
  uploadedAt: string;
}
