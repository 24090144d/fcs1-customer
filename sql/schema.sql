-- Generated from Azure PostgreSQL (live scan)
-- Generated at 2026-05-16T15:18:11.935Z

BEGIN;

CREATE TABLE IF NOT EXISTS public."im_dashboard_json" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "upload_job_id" uuid NOT NULL,
  "schema_version" text NOT NULL,
  "generated_json" jsonb NOT NULL,
  "generated_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "im_dashboard_json_pkey" PRIMARY KEY (id),
  CONSTRAINT "im_dashboard_json_upload_job_id_key" UNIQUE (upload_job_id)
);

CREATE TABLE IF NOT EXISTS public."im_records" (
  "id" bigint NOT NULL,
  "organization_id" uuid NOT NULL,
  "upload_job_id" uuid NOT NULL,
  "uploaded_file_id" uuid,
  "source_row_id" bigint,
  "incident_case" text,
  "incident_status" text,
  "incident_category" text,
  "incident_item_name" text,
  "incident_description" text,
  "incident_location" text,
  "severity" text,
  "subject" text,
  "source_of_complaint" text,
  "created_date" timestamp with time zone,
  "incident_datetime" timestamp with time zone,
  "guest_name" text,
  "room_no" text,
  "profile_type" text,
  "vip_code" text,
  "membership_number" text,
  "reservation_number" text,
  "date_of_birth" text,
  "company_name" text,
  "arrival_date" timestamp with time zone,
  "departure_date" timestamp with time zone,
  "nights" numeric,
  "rates" text,
  "rate_code" text,
  "booking_source" text,
  "visits" text,
  "created_by" text,
  "department" text,
  "investigation_1" text,
  "investigation_remarks_1" text,
  "investigation_updated_by_1" text,
  "investigation_updated_on_1" timestamp with time zone,
  "investigation_2" text,
  "investigation_remarks_2" text,
  "investigation_updated_by_2" text,
  "investigation_updated_on_2" timestamp with time zone,
  "feedback_method_1" text,
  "feedback_updated_by_1" text,
  "feedback_updated_on_1" timestamp with time zone,
  "feedback_remarks_1" text,
  "normalized_row" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "chain_code" text,
  "hotel_code" text,
  "module_code" text,
  "country_code" text,
  CONSTRAINT "im_records_pkey" PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public."im_staging_rows" (
  "id" bigint NOT NULL,
  "organization_id" uuid NOT NULL,
  "upload_job_id" uuid NOT NULL,
  "uploaded_file_id" uuid NOT NULL,
  "row_number" integer NOT NULL,
  "raw_row" jsonb NOT NULL,
  "parse_error" text,
  "is_valid" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "im_staging_rows_pkey" PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public."jo_dashboard_json" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "upload_job_id" uuid NOT NULL,
  "schema_version" text NOT NULL,
  "generated_json" jsonb NOT NULL,
  "generated_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "jo_dashboard_json_pkey" PRIMARY KEY (id),
  CONSTRAINT "jo_dashboard_json_upload_job_id_key" UNIQUE (upload_job_id)
);

CREATE TABLE IF NOT EXISTS public."jo_records" (
  "id" bigint NOT NULL,
  "organization_id" uuid NOT NULL,
  "upload_job_id" uuid NOT NULL,
  "uploaded_file_id" uuid,
  "source_row_id" bigint,
  "department_name" text,
  "created_datetime" timestamp with time zone,
  "job_status" text,
  "job_order" text,
  "guest_name" text,
  "location" text,
  "service_item_category" text,
  "service_item" text,
  "quantity" numeric,
  "remarks" text,
  "execution_duration" text,
  "initial_deadline" timestamp with time zone,
  "extended_deadline" timestamp with time zone,
  "acknowledged_datetime" timestamp with time zone,
  "completed_datetime" timestamp with time zone,
  "delay_duration" text,
  "created_by_department" text,
  "created_by_user" text,
  "assigned_to_department" text,
  "assigned_to_user" text,
  "acknowledged_by_department" text,
  "acknowledged_by_user" text,
  "completed_by_department" text,
  "completed_by_user" text,
  "total_hour_between_created_to_completed" text,
  "total_act_between_acknowledged_to_completed" text,
  "comments" text,
  "attachment" text,
  "reassigned_job" text,
  "escalation_group" text,
  "normalized_row" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "chain_code" text,
  "hotel_code" text,
  "module_code" text,
  "country_code" text,
  CONSTRAINT "jo_records_pkey" PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public."jo_staging_rows" (
  "id" bigint NOT NULL,
  "organization_id" uuid NOT NULL,
  "upload_job_id" uuid NOT NULL,
  "uploaded_file_id" uuid NOT NULL,
  "row_number" integer NOT NULL,
  "raw_row" jsonb NOT NULL,
  "parse_error" text,
  "is_valid" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "jo_staging_rows_pkey" PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public."organizations" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "organization_code" text NOT NULL,
  "organization_name" text NOT NULL,
  "timezone" text DEFAULT 'UTC'::text NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "organizations_pkey" PRIMARY KEY (id),
  CONSTRAINT "organizations_organization_code_key" UNIQUE (organization_code)
);

CREATE TABLE IF NOT EXISTS public."upload_jobs" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "module_code" module_code NOT NULL,
  "status" upload_job_status DEFAULT 'pending'::upload_job_status NOT NULL,
  "source_name" text,
  "requested_by" uuid,
  "started_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "failed_reason" text,
  "total_files" integer DEFAULT 0 NOT NULL,
  "total_rows" integer DEFAULT 0 NOT NULL,
  "processed_rows" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "upload_jobs_pkey" PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public."uploaded_files" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "upload_job_id" uuid NOT NULL,
  "module_code" module_code NOT NULL,
  "file_name" text NOT NULL,
  "mime_type" text,
  "file_size_bytes" bigint,
  "file_hash" text NOT NULL,
  "storage_bucket" text,
  "storage_path" text,
  "uploaded_by" uuid,
  "uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "uploaded_files_pkey" PRIMARY KEY (id)
);

ALTER TABLE ONLY public."im_dashboard_json"
  ADD CONSTRAINT "im_dashboard_json_upload_job_id_fkey" FOREIGN KEY (upload_job_id) REFERENCES upload_jobs(id) ON DELETE CASCADE;

ALTER TABLE ONLY public."im_records"
  ADD CONSTRAINT "im_records_upload_job_id_fkey" FOREIGN KEY (upload_job_id) REFERENCES upload_jobs(id) ON DELETE CASCADE;

ALTER TABLE ONLY public."im_records"
  ADD CONSTRAINT "im_records_uploaded_file_id_fkey" FOREIGN KEY (uploaded_file_id) REFERENCES uploaded_files(id);

ALTER TABLE ONLY public."im_staging_rows"
  ADD CONSTRAINT "im_staging_rows_upload_job_id_fkey" FOREIGN KEY (upload_job_id) REFERENCES upload_jobs(id) ON DELETE CASCADE;

ALTER TABLE ONLY public."im_staging_rows"
  ADD CONSTRAINT "im_staging_rows_uploaded_file_id_fkey" FOREIGN KEY (uploaded_file_id) REFERENCES uploaded_files(id) ON DELETE CASCADE;

ALTER TABLE ONLY public."jo_dashboard_json"
  ADD CONSTRAINT "jo_dashboard_json_upload_job_id_fkey" FOREIGN KEY (upload_job_id) REFERENCES upload_jobs(id) ON DELETE CASCADE;

ALTER TABLE ONLY public."jo_records"
  ADD CONSTRAINT "jo_records_upload_job_id_fkey" FOREIGN KEY (upload_job_id) REFERENCES upload_jobs(id) ON DELETE CASCADE;

ALTER TABLE ONLY public."jo_records"
  ADD CONSTRAINT "jo_records_uploaded_file_id_fkey" FOREIGN KEY (uploaded_file_id) REFERENCES uploaded_files(id);

ALTER TABLE ONLY public."jo_staging_rows"
  ADD CONSTRAINT "jo_staging_rows_upload_job_id_fkey" FOREIGN KEY (upload_job_id) REFERENCES upload_jobs(id) ON DELETE CASCADE;

ALTER TABLE ONLY public."jo_staging_rows"
  ADD CONSTRAINT "jo_staging_rows_uploaded_file_id_fkey" FOREIGN KEY (uploaded_file_id) REFERENCES uploaded_files(id) ON DELETE CASCADE;

ALTER TABLE ONLY public."uploaded_files"
  ADD CONSTRAINT "uploaded_files_upload_job_id_fkey" FOREIGN KEY (upload_job_id) REFERENCES upload_jobs(id) ON DELETE CASCADE;

CREATE INDEX im_dashboard_json_created_idx ON public.im_dashboard_json USING btree (created_at);
CREATE INDEX im_dashboard_json_job_idx ON public.im_dashboard_json USING btree (upload_job_id);
CREATE UNIQUE INDEX im_dashboard_json_pkey ON public.im_dashboard_json USING btree (id);
CREATE UNIQUE INDEX im_dashboard_json_upload_job_id_key ON public.im_dashboard_json USING btree (upload_job_id);

CREATE INDEX im_records_booking_source_idx ON public.im_records USING btree (booking_source);
CREATE INDEX im_records_created_date_idx ON public.im_records USING btree (created_date);
CREATE INDEX im_records_department_idx ON public.im_records USING btree (department);
CREATE INDEX im_records_incident_category_idx ON public.im_records USING btree (incident_category);
CREATE INDEX im_records_incident_datetime_idx ON public.im_records USING btree (incident_datetime);
CREATE INDEX im_records_incident_status_idx ON public.im_records USING btree (incident_status);
CREATE INDEX im_records_job_idx ON public.im_records USING btree (upload_job_id);
CREATE UNIQUE INDEX im_records_pkey ON public.im_records USING btree (id);
CREATE INDEX im_records_profile_type_idx ON public.im_records USING btree (profile_type);
CREATE INDEX im_records_scope_idx ON public.im_records USING btree (chain_code, hotel_code, module_code, country_code);
CREATE INDEX im_records_severity_idx ON public.im_records USING btree (severity);
CREATE INDEX im_records_vip_code_idx ON public.im_records USING btree (vip_code);

CREATE INDEX im_staging_rows_job_idx ON public.im_staging_rows USING btree (upload_job_id);
CREATE INDEX im_staging_rows_job_row_idx ON public.im_staging_rows USING btree (upload_job_id, row_number);
CREATE UNIQUE INDEX im_staging_rows_pkey ON public.im_staging_rows USING btree (id);

CREATE INDEX jo_dashboard_json_job_idx ON public.jo_dashboard_json USING btree (upload_job_id);
CREATE UNIQUE INDEX jo_dashboard_json_pkey ON public.jo_dashboard_json USING btree (id);
CREATE UNIQUE INDEX jo_dashboard_json_upload_job_id_key ON public.jo_dashboard_json USING btree (upload_job_id);

CREATE INDEX jo_records_created_datetime_idx ON public.jo_records USING btree (created_datetime);
CREATE INDEX jo_records_job_idx ON public.jo_records USING btree (upload_job_id);
CREATE UNIQUE INDEX jo_records_pkey ON public.jo_records USING btree (id);
CREATE INDEX jo_records_scope_idx ON public.jo_records USING btree (chain_code, hotel_code, module_code, country_code);
CREATE INDEX jo_records_status_idx ON public.jo_records USING btree (job_status);

CREATE INDEX jo_staging_rows_job_idx ON public.jo_staging_rows USING btree (upload_job_id);
CREATE INDEX jo_staging_rows_job_row_idx ON public.jo_staging_rows USING btree (upload_job_id, row_number);
CREATE UNIQUE INDEX jo_staging_rows_pkey ON public.jo_staging_rows USING btree (id);

CREATE INDEX organizations_code_idx ON public.organizations USING btree (organization_code);
CREATE UNIQUE INDEX organizations_organization_code_key ON public.organizations USING btree (organization_code);
CREATE UNIQUE INDEX organizations_pkey ON public.organizations USING btree (id);

CREATE INDEX upload_jobs_module_idx ON public.upload_jobs USING btree (module_code);
CREATE INDEX upload_jobs_org_idx ON public.upload_jobs USING btree (organization_id);
CREATE UNIQUE INDEX upload_jobs_pkey ON public.upload_jobs USING btree (id);
CREATE INDEX upload_jobs_status_idx ON public.upload_jobs USING btree (status);

CREATE INDEX uploaded_files_hash_lookup_idx ON public.uploaded_files USING btree (organization_id, module_code, file_hash);
CREATE INDEX uploaded_files_job_idx ON public.uploaded_files USING btree (upload_job_id);
CREATE UNIQUE INDEX uploaded_files_pkey ON public.uploaded_files USING btree (id);

COMMIT;
