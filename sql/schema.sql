--
-- PostgreSQL database dump
--

\restrict dp3wuPBhbcjyPaLhqSSzOzKApE7uokM5Z2n6jEJNZ8yy3booDTrkXxfCahVhMSX

-- Dumped from database version 18.3
-- Dumped by pg_dump version 18.4 (Debian 18.4-1.pgdg13+1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

-- *not* creating schema, since initdb creates it


--
-- Name: module_code; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.module_code AS ENUM (
    'im',
    'jo'
);


--
-- Name: upload_job_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.upload_job_status AS ENUM (
    'pending',
    'processing',
    'completed',
    'failed'
);


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: ai_chart_definitions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_chart_definitions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    title text NOT NULL,
    chart_type text NOT NULL,
    module_code text NOT NULL,
    prompt text NOT NULL,
    query_spec_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    chart_config_json jsonb NOT NULL,
    created_by text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    is_published boolean DEFAULT false NOT NULL,
    published_at timestamp with time zone,
    display_order integer,
    CONSTRAINT ai_chart_definitions_module_code_check CHECK ((module_code = ANY (ARRAY['im'::text, 'jo'::text])))
);


--
-- Name: im_dashboard_json; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.im_dashboard_json (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    upload_job_id uuid NOT NULL,
    schema_version text NOT NULL,
    generated_json jsonb NOT NULL,
    generated_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: im_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.im_records (
    id bigint NOT NULL,
    organization_id uuid NOT NULL,
    upload_job_id uuid NOT NULL,
    uploaded_file_id uuid,
    source_row_id bigint,
    incident_case text,
    incident_status text,
    incident_category text,
    incident_item_name text,
    incident_description text,
    incident_location text,
    severity text,
    subject text,
    source_of_complaint text,
    created_date timestamp with time zone,
    incident_datetime timestamp with time zone,
    guest_name text,
    room_no text,
    profile_type text,
    vip_code text,
    membership_number text,
    reservation_number text,
    date_of_birth text,
    company_name text,
    arrival_date timestamp with time zone,
    departure_date timestamp with time zone,
    nights numeric,
    rates text,
    rate_code text,
    booking_source text,
    visits text,
    created_by text,
    department text,
    investigation_1 text,
    investigation_remarks_1 text,
    investigation_updated_by_1 text,
    investigation_updated_on_1 timestamp with time zone,
    investigation_2 text,
    investigation_remarks_2 text,
    investigation_updated_by_2 text,
    investigation_updated_on_2 timestamp with time zone,
    feedback_method_1 text,
    feedback_updated_by_1 text,
    feedback_updated_on_1 timestamp with time zone,
    feedback_remarks_1 text,
    normalized_row jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    chain_code text,
    hotel_code text,
    module_code text,
    country_code text
);


--
-- Name: im_records_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.im_records_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: im_records_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.im_records_id_seq OWNED BY public.im_records.id;


--
-- Name: im_staging_rows; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.im_staging_rows (
    id bigint NOT NULL,
    organization_id uuid NOT NULL,
    upload_job_id uuid NOT NULL,
    uploaded_file_id uuid NOT NULL,
    row_number integer NOT NULL,
    raw_row jsonb NOT NULL,
    parse_error text,
    is_valid boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: im_staging_rows_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.im_staging_rows_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: im_staging_rows_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.im_staging_rows_id_seq OWNED BY public.im_staging_rows.id;


--
-- Name: jo_dashboard_json; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.jo_dashboard_json (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    upload_job_id uuid NOT NULL,
    schema_version text NOT NULL,
    generated_json jsonb NOT NULL,
    generated_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: jo_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.jo_records (
    id bigint NOT NULL,
    organization_id uuid NOT NULL,
    upload_job_id uuid NOT NULL,
    uploaded_file_id uuid,
    source_row_id bigint,
    department_name text,
    created_datetime timestamp with time zone,
    job_status text,
    job_order text,
    guest_name text,
    location text,
    service_item_category text,
    service_item text,
    quantity numeric,
    remarks text,
    execution_duration text,
    initial_deadline timestamp with time zone,
    extended_deadline timestamp with time zone,
    acknowledged_datetime timestamp with time zone,
    completed_datetime timestamp with time zone,
    delay_duration text,
    created_by_department text,
    created_by_user text,
    assigned_to_department text,
    assigned_to_user text,
    acknowledged_by_department text,
    acknowledged_by_user text,
    completed_by_department text,
    completed_by_user text,
    total_hour_between_created_to_completed text,
    total_act_between_acknowledged_to_completed text,
    comments text,
    attachment text,
    reassigned_job text,
    escalation_group text,
    normalized_row jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    chain_code text,
    hotel_code text,
    module_code text,
    country_code text
);


--
-- Name: jo_records_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.jo_records_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: jo_records_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.jo_records_id_seq OWNED BY public.jo_records.id;


--
-- Name: jo_staging_rows; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.jo_staging_rows (
    id bigint NOT NULL,
    organization_id uuid NOT NULL,
    upload_job_id uuid NOT NULL,
    uploaded_file_id uuid NOT NULL,
    row_number integer NOT NULL,
    raw_row jsonb NOT NULL,
    parse_error text,
    is_valid boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: jo_staging_rows_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.jo_staging_rows_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: jo_staging_rows_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.jo_staging_rows_id_seq OWNED BY public.jo_staging_rows.id;


--
-- Name: organizations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organizations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_code text NOT NULL,
    organization_name text NOT NULL,
    timezone text DEFAULT 'UTC'::text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: upload_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.upload_jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    module_code public.module_code NOT NULL,
    status public.upload_job_status DEFAULT 'pending'::public.upload_job_status NOT NULL,
    source_name text,
    requested_by uuid,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    failed_reason text,
    total_files integer DEFAULT 0 NOT NULL,
    total_rows integer DEFAULT 0 NOT NULL,
    processed_rows integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: uploaded_files; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.uploaded_files (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    upload_job_id uuid NOT NULL,
    module_code public.module_code NOT NULL,
    file_name text NOT NULL,
    mime_type text,
    file_size_bytes bigint,
    file_hash text NOT NULL,
    storage_bucket text,
    storage_path text,
    uploaded_by uuid,
    uploaded_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_chart_visibility; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_chart_visibility (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id text NOT NULL,
    chart_id uuid NOT NULL,
    is_hidden boolean DEFAULT false NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: im_records id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.im_records ALTER COLUMN id SET DEFAULT nextval('public.im_records_id_seq'::regclass);


--
-- Name: im_staging_rows id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.im_staging_rows ALTER COLUMN id SET DEFAULT nextval('public.im_staging_rows_id_seq'::regclass);


--
-- Name: jo_records id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jo_records ALTER COLUMN id SET DEFAULT nextval('public.jo_records_id_seq'::regclass);


--
-- Name: jo_staging_rows id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jo_staging_rows ALTER COLUMN id SET DEFAULT nextval('public.jo_staging_rows_id_seq'::regclass);


--
-- Name: ai_chart_definitions ai_chart_definitions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_chart_definitions
    ADD CONSTRAINT ai_chart_definitions_pkey PRIMARY KEY (id);


--
-- Name: im_dashboard_json im_dashboard_json_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.im_dashboard_json
    ADD CONSTRAINT im_dashboard_json_pkey PRIMARY KEY (id);


--
-- Name: im_dashboard_json im_dashboard_json_upload_job_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.im_dashboard_json
    ADD CONSTRAINT im_dashboard_json_upload_job_id_key UNIQUE (upload_job_id);


--
-- Name: im_records im_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.im_records
    ADD CONSTRAINT im_records_pkey PRIMARY KEY (id);


--
-- Name: im_staging_rows im_staging_rows_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.im_staging_rows
    ADD CONSTRAINT im_staging_rows_pkey PRIMARY KEY (id);


--
-- Name: jo_dashboard_json jo_dashboard_json_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jo_dashboard_json
    ADD CONSTRAINT jo_dashboard_json_pkey PRIMARY KEY (id);


--
-- Name: jo_dashboard_json jo_dashboard_json_upload_job_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jo_dashboard_json
    ADD CONSTRAINT jo_dashboard_json_upload_job_id_key UNIQUE (upload_job_id);


--
-- Name: jo_records jo_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jo_records
    ADD CONSTRAINT jo_records_pkey PRIMARY KEY (id);


--
-- Name: jo_staging_rows jo_staging_rows_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jo_staging_rows
    ADD CONSTRAINT jo_staging_rows_pkey PRIMARY KEY (id);


--
-- Name: organizations organizations_organization_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_organization_code_key UNIQUE (organization_code);


--
-- Name: organizations organizations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_pkey PRIMARY KEY (id);


--
-- Name: upload_jobs upload_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.upload_jobs
    ADD CONSTRAINT upload_jobs_pkey PRIMARY KEY (id);


--
-- Name: uploaded_files uploaded_files_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.uploaded_files
    ADD CONSTRAINT uploaded_files_pkey PRIMARY KEY (id);


--
-- Name: user_chart_visibility user_chart_visibility_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_chart_visibility
    ADD CONSTRAINT user_chart_visibility_pkey PRIMARY KEY (id);


--
-- Name: user_chart_visibility user_chart_visibility_user_id_chart_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_chart_visibility
    ADD CONSTRAINT user_chart_visibility_user_id_chart_id_key UNIQUE (user_id, chart_id);


--
-- Name: ai_chart_definitions_order_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_chart_definitions_order_idx ON public.ai_chart_definitions USING btree (organization_id, module_code, is_active, display_order, created_at DESC);


--
-- Name: ai_chart_definitions_org_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_chart_definitions_org_idx ON public.ai_chart_definitions USING btree (organization_id, module_code, created_at DESC);


--
-- Name: ai_chart_definitions_published_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_chart_definitions_published_idx ON public.ai_chart_definitions USING btree (organization_id, module_code, is_published, created_at DESC);


--
-- Name: im_dashboard_json_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX im_dashboard_json_created_idx ON public.im_dashboard_json USING btree (created_at);


--
-- Name: im_dashboard_json_job_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX im_dashboard_json_job_idx ON public.im_dashboard_json USING btree (upload_job_id);


--
-- Name: im_records_booking_source_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX im_records_booking_source_idx ON public.im_records USING btree (booking_source);


--
-- Name: im_records_created_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX im_records_created_date_idx ON public.im_records USING btree (created_date);


--
-- Name: im_records_department_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX im_records_department_idx ON public.im_records USING btree (department);


--
-- Name: im_records_incident_category_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX im_records_incident_category_idx ON public.im_records USING btree (incident_category);


--
-- Name: im_records_incident_datetime_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX im_records_incident_datetime_idx ON public.im_records USING btree (incident_datetime);


--
-- Name: im_records_incident_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX im_records_incident_status_idx ON public.im_records USING btree (incident_status);


--
-- Name: im_records_job_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX im_records_job_idx ON public.im_records USING btree (upload_job_id);


--
-- Name: im_records_profile_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX im_records_profile_type_idx ON public.im_records USING btree (profile_type);


--
-- Name: im_records_scope_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX im_records_scope_idx ON public.im_records USING btree (chain_code, hotel_code, module_code, country_code);


--
-- Name: im_records_severity_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX im_records_severity_idx ON public.im_records USING btree (severity);


--
-- Name: im_records_vip_code_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX im_records_vip_code_idx ON public.im_records USING btree (vip_code);


--
-- Name: im_staging_rows_job_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX im_staging_rows_job_idx ON public.im_staging_rows USING btree (upload_job_id);


--
-- Name: im_staging_rows_job_row_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX im_staging_rows_job_row_idx ON public.im_staging_rows USING btree (upload_job_id, row_number);


--
-- Name: jo_dashboard_json_job_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX jo_dashboard_json_job_idx ON public.jo_dashboard_json USING btree (upload_job_id);


--
-- Name: jo_records_created_datetime_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX jo_records_created_datetime_idx ON public.jo_records USING btree (created_datetime);


--
-- Name: jo_records_department_name_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX jo_records_department_name_idx ON public.jo_records USING btree (department_name);


--
-- Name: jo_records_job_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX jo_records_job_idx ON public.jo_records USING btree (upload_job_id);


--
-- Name: jo_records_job_order_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX jo_records_job_order_idx ON public.jo_records USING btree (job_order);


--
-- Name: jo_records_scope_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX jo_records_scope_idx ON public.jo_records USING btree (chain_code, hotel_code, module_code, country_code);


--
-- Name: jo_records_service_item_category_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX jo_records_service_item_category_idx ON public.jo_records USING btree (service_item_category);


--
-- Name: jo_records_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX jo_records_status_idx ON public.jo_records USING btree (job_status);


--
-- Name: jo_staging_rows_job_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX jo_staging_rows_job_idx ON public.jo_staging_rows USING btree (upload_job_id);


--
-- Name: jo_staging_rows_job_row_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX jo_staging_rows_job_row_idx ON public.jo_staging_rows USING btree (upload_job_id, row_number);


--
-- Name: organizations_code_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX organizations_code_idx ON public.organizations USING btree (organization_code);


--
-- Name: upload_jobs_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX upload_jobs_created_at_idx ON public.upload_jobs USING btree (created_at DESC);


--
-- Name: upload_jobs_module_code_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX upload_jobs_module_code_idx ON public.upload_jobs USING btree (module_code);


--
-- Name: upload_jobs_module_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX upload_jobs_module_idx ON public.upload_jobs USING btree (module_code);


--
-- Name: upload_jobs_org_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX upload_jobs_org_idx ON public.upload_jobs USING btree (organization_id);


--
-- Name: upload_jobs_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX upload_jobs_status_idx ON public.upload_jobs USING btree (status);


--
-- Name: uploaded_files_file_hash_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX uploaded_files_file_hash_idx ON public.uploaded_files USING btree (file_hash);


--
-- Name: uploaded_files_hash_lookup_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX uploaded_files_hash_lookup_idx ON public.uploaded_files USING btree (organization_id, module_code, file_hash);


--
-- Name: uploaded_files_job_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX uploaded_files_job_idx ON public.uploaded_files USING btree (upload_job_id);


--
-- Name: user_chart_visibility_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_chart_visibility_user_idx ON public.user_chart_visibility USING btree (user_id, is_hidden);


--
-- Name: ai_chart_definitions ai_chart_definitions_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_chart_definitions
    ADD CONSTRAINT ai_chart_definitions_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: im_dashboard_json im_dashboard_json_upload_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.im_dashboard_json
    ADD CONSTRAINT im_dashboard_json_upload_job_id_fkey FOREIGN KEY (upload_job_id) REFERENCES public.upload_jobs(id) ON DELETE CASCADE;


--
-- Name: im_records im_records_upload_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.im_records
    ADD CONSTRAINT im_records_upload_job_id_fkey FOREIGN KEY (upload_job_id) REFERENCES public.upload_jobs(id) ON DELETE CASCADE;


--
-- Name: im_records im_records_uploaded_file_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.im_records
    ADD CONSTRAINT im_records_uploaded_file_id_fkey FOREIGN KEY (uploaded_file_id) REFERENCES public.uploaded_files(id);


--
-- Name: im_staging_rows im_staging_rows_upload_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.im_staging_rows
    ADD CONSTRAINT im_staging_rows_upload_job_id_fkey FOREIGN KEY (upload_job_id) REFERENCES public.upload_jobs(id) ON DELETE CASCADE;


--
-- Name: im_staging_rows im_staging_rows_uploaded_file_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.im_staging_rows
    ADD CONSTRAINT im_staging_rows_uploaded_file_id_fkey FOREIGN KEY (uploaded_file_id) REFERENCES public.uploaded_files(id) ON DELETE CASCADE;


--
-- Name: jo_dashboard_json jo_dashboard_json_upload_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jo_dashboard_json
    ADD CONSTRAINT jo_dashboard_json_upload_job_id_fkey FOREIGN KEY (upload_job_id) REFERENCES public.upload_jobs(id) ON DELETE CASCADE;


--
-- Name: jo_records jo_records_upload_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jo_records
    ADD CONSTRAINT jo_records_upload_job_id_fkey FOREIGN KEY (upload_job_id) REFERENCES public.upload_jobs(id) ON DELETE CASCADE;


--
-- Name: jo_records jo_records_uploaded_file_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jo_records
    ADD CONSTRAINT jo_records_uploaded_file_id_fkey FOREIGN KEY (uploaded_file_id) REFERENCES public.uploaded_files(id);


--
-- Name: jo_staging_rows jo_staging_rows_upload_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jo_staging_rows
    ADD CONSTRAINT jo_staging_rows_upload_job_id_fkey FOREIGN KEY (upload_job_id) REFERENCES public.upload_jobs(id) ON DELETE CASCADE;


--
-- Name: jo_staging_rows jo_staging_rows_uploaded_file_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jo_staging_rows
    ADD CONSTRAINT jo_staging_rows_uploaded_file_id_fkey FOREIGN KEY (uploaded_file_id) REFERENCES public.uploaded_files(id) ON DELETE CASCADE;


--
-- Name: uploaded_files uploaded_files_upload_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.uploaded_files
    ADD CONSTRAINT uploaded_files_upload_job_id_fkey FOREIGN KEY (upload_job_id) REFERENCES public.upload_jobs(id) ON DELETE CASCADE;


--
-- Name: user_chart_visibility user_chart_visibility_chart_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_chart_visibility
    ADD CONSTRAINT user_chart_visibility_chart_id_fkey FOREIGN KEY (chart_id) REFERENCES public.ai_chart_definitions(id) ON DELETE CASCADE;


--
-- Name: upload_jobs Service role full access on upload_jobs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role full access on upload_jobs" ON public.upload_jobs USING (true) WITH CHECK (true);


--
-- Name: uploaded_files Service role full access on uploaded_files; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role full access on uploaded_files" ON public.uploaded_files USING (true) WITH CHECK (true);


--
-- Name: upload_jobs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.upload_jobs ENABLE ROW LEVEL SECURITY;

--
-- Name: uploaded_files; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.uploaded_files ENABLE ROW LEVEL SECURITY;

--
-- PostgreSQL database dump complete
--

\unrestrict dp3wuPBhbcjyPaLhqSSzOzKApE7uokM5Z2n6jEJNZ8yy3booDTrkXxfCahVhMSX

