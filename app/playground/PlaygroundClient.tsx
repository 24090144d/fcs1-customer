'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Highcharts from 'highcharts';
import HighchartsReact from 'highcharts-react-official';
import { GripVertical, Hourglass, Pencil, Check, X } from 'lucide-react';
import { KpiCard } from '@/components/dashboard/KpiCard';
import type { KpiDef } from '@/types/dashboard';

function initHighchartsModule(mod: unknown) {
  const fn = (mod as { default?: unknown })?.default ?? mod;
  if (typeof fn === 'function') {
    fn(Highcharts);
  }
}

type Generated = {
  organization_id: string;
  module_code: ModuleKey;
  title: string;
  chart_type: string;
  query_spec_json: Record<string, unknown>;
  chart_config_json: Highcharts.Options;
  assistant_text: string;
  chart_note?: string;
  chart_formula?: string;
  kpis?: KpiDef[];
  diagnostics?: {
    mode?: string;
    supported_fields?: string[];
    requested_fields?: string[];
    resolved_fields?: string[];
    fallback?: boolean;
    fallback_reasons?: string[];
  };
};

type SavedChart = {
  id: string;
  title: string;
  chart_type: string;
  module_code: string;
  chart_config_json: Highcharts.Options;
  is_hidden: boolean;
  is_published?: boolean;
  display_order?: number | null;
};
type Notice = { type: 'success' | 'error' | 'info'; message: string } | null;
type ActivityItem = { id: string; ts: number; message: string; type: 'success' | 'error' | 'info' };

type ModuleKey = 'jo' | 'mo' | 'co' | 'im';
type ThemeKey  = 'vintage' | 'modern' | 'executive';

type DataSourceItem = {
  upload_job_id: string;
  file_name: string;       // original CSV filename from uploaded_files
  module_code: ModuleKey;
  organization_id: string;
  // parsed from filename: [ChainCode]-[HotelCode]-[HotelName]-[Module]-[CountryCode]-[DataRange].csv
  chain_code: string;      // e.g. "SCL"
  hotel_code: string;      // e.g. "CON"
  hotel_name: string;      // e.g. "Conrad Macau"
  country_code: string;    // e.g. "MO"
  data_range: string;      // e.g. "1w"
  created_at: string;
};

type QuickPattern = {
  label: string;
  moduleCode: ModuleKey;
  prompt: string;
};

interface TemplateGroup {
  kpis:  QuickPattern[];
  hotel: QuickPattern[];
  corp:  QuickPattern[];
}

const IM_FIELD_LEGEND: Array<{ field: string; aliases: string[] }> = [
  { field: 'incident_case', aliases: ['incident case', 'case id', 'case'] },
  { field: 'department', aliases: ['department', 'dept', 'team', 'function'] },
  { field: 'incident_category', aliases: ['incident category', 'category', 'categories'] },
  { field: 'incident_item_name', aliases: ['incident item name', 'incident item', 'item', 'incident case'] },
  { field: 'incident_description', aliases: ['incident description', 'description', 'details'] },
  { field: 'incident_status', aliases: ['incident status', 'status', 'state'] },
  { field: 'severity', aliases: ['severity', 'priority', 'criticality'] },
  { field: 'subject', aliases: ['subject', 'title'] },
  { field: 'source_of_complaint', aliases: ['source of complaint', 'complaint source', 'source', 'channel'] },
  { field: 'guest_name', aliases: ['guest name', 'guest'] },
  { field: 'room_no', aliases: ['room no', 'room number', 'room'] },
  { field: 'booking_source', aliases: ['booking source', 'booking channel', 'booking'] },
  { field: 'incident_location', aliases: ['incident location', 'location', 'area', 'place'] },
  { field: 'hotel_code', aliases: ['hotel', 'hotel code', 'property'] },
  { field: 'country_code', aliases: ['country', 'nation', 'region'] },
  { field: 'vip_code', aliases: ['vip code', 'vip', 'vip guest'] },
  { field: 'profile_type', aliases: ['profile type', 'guest profile', 'profile'] },
  { field: 'membership_number', aliases: ['membership number', 'member no', 'member id'] },
  { field: 'reservation_number', aliases: ['reservation number', 'booking number', 'reservation no'] },
  { field: 'date_of_birth', aliases: ['date of birth', 'dob', 'birth date'] },
  { field: 'company_name', aliases: ['company name', 'company', 'corporate name'] },
  { field: 'arrival_date', aliases: ['arrival date', 'check in', 'check-in'] },
  { field: 'departure_date', aliases: ['departure date', 'check out', 'check-out'] },
  { field: 'nights', aliases: ['nights', 'night count', 'stay nights'] },
  { field: 'rates', aliases: ['rates', 'room rate', 'rate amount'] },
  { field: 'rate_code', aliases: ['rate code', 'room rate code', 'tariff code'] },
  { field: 'visits', aliases: ['visits', 'visit count'] },
  { field: 'created_by', aliases: ['created by', 'creator', 'owner'] },
  { field: 'chain_code', aliases: ['chain code', 'brand code', 'chain'] },
  { field: 'module_code', aliases: ['module code', 'module', 'im', 'jo', 'co'] },
  { field: 'created_date', aliases: ['created date', 'created datetime', 'creation date'] },
  { field: 'incident_datetime', aliases: ['incident datetime', 'incident date', 'incident time', 'incident timestamp'] },
  { field: 'investigation_1', aliases: ['investigation 1', 'investigation first'] },
  { field: 'investigation_remarks_1', aliases: ['investigation remarks 1', 'investigation note 1'] },
  { field: 'investigation_updated_by_1', aliases: ['investigation updated by 1'] },
  { field: 'investigation_updated_on_1', aliases: ['investigation updated on 1'] },
  { field: 'investigation_2', aliases: ['investigation 2', 'investigation second'] },
  { field: 'investigation_remarks_2', aliases: ['investigation remarks 2', 'investigation note 2'] },
  { field: 'investigation_updated_by_2', aliases: ['investigation updated by 2'] },
  { field: 'investigation_updated_on_2', aliases: ['investigation updated on 2'] },
  { field: 'feedback_method_1', aliases: ['feedback method 1', 'feedback method'] },
  { field: 'feedback_updated_by_1', aliases: ['feedback updated by 1'] },
  { field: 'feedback_updated_on_1', aliases: ['feedback updated on 1'] },
  { field: 'feedback_remarks_1', aliases: ['feedback remarks 1', 'feedback note 1'] },
];
const IM_QUERY_ENABLED_FIELDS: string[] = [
  'incident_case',
  'incident_status',
  'incident_category',
  'incident_item_name',
  'incident_description',
  'incident_location',
  'severity',
  'subject',
  'source_of_complaint',
  'created_date',
  'incident_datetime',
  'guest_name',
  'room_no',
  'profile_type',
  'vip_code',
  'membership_number',
  'reservation_number',
  'date_of_birth',
  'company_name',
  'arrival_date',
  'departure_date',
  'nights',
  'rates',
  'rate_code',
  'booking_source',
  'visits',
  'created_by',
  'department',
  'investigation_1',
  'investigation_remarks_1',
  'investigation_updated_by_1',
  'investigation_updated_on_1',
  'investigation_2',
  'investigation_remarks_2',
  'investigation_updated_by_2',
  'investigation_updated_on_2',
  'feedback_method_1',
  'feedback_updated_by_1',
  'feedback_updated_on_1',
  'feedback_remarks_1',
  'chain_code',
  'hotel_code',
  'module_code',
  'country_code',
];
const IM_SCHEMA_FIELDS: string[] = [
  'incident_case',
  'incident_status',
  'incident_category',
  'incident_item_name',
  'incident_description',
  'incident_location',
  'severity',
  'subject',
  'source_of_complaint',
  'created_date',
  'incident_datetime',
  'guest_name',
  'room_no',
  'profile_type',
  'vip_code',
  'membership_number',
  'reservation_number',
  'date_of_birth',
  'company_name',
  'arrival_date',
  'departure_date',
  'nights',
  'rates',
  'rate_code',
  'booking_source',
  'visits',
  'created_by',
  'department',
  'investigation_1',
  'investigation_remarks_1',
  'investigation_updated_by_1',
  'investigation_updated_on_1',
  'investigation_2',
  'investigation_remarks_2',
  'investigation_updated_by_2',
  'investigation_updated_on_2',
  'feedback_method_1',
  'feedback_updated_by_1',
  'feedback_updated_on_1',
  'feedback_remarks_1',
  'chain_code',
  'hotel_code',
  'module_code',
  'country_code',
];
const IM_TIME_ALIASES = ['created date', 'incident date', 'hourly', 'daily', 'weekly', 'monthly', 'quarterly', 'Q1/Q2/Q3/Q4'];
const IM_CALC_ALIASES = ['rate', 'percent', 'percentage', 'pct', 'ratio', 'share', 'average', 'avg', 'mean'];

// ── JO Field Legend ──────────────────────────────────────────────────────────
const JO_FIELD_LEGEND: Array<{ field: string; queryEnabled: boolean; aliases: string[] }> = [
  { field: 'job_order_id',          queryEnabled: true,  aliases: ['job order id', 'job id', 'order id'] },
  { field: 'status',                queryEnabled: true,  aliases: ['status', 'job status', 'state'] },
  { field: 'service_category',      queryEnabled: true,  aliases: ['service category', 'category', 'categories'] },
  { field: 'service_item',          queryEnabled: true,  aliases: ['service item', 'item', 'items'] },
  { field: 'department',            queryEnabled: true,  aliases: ['department', 'dept', 'team'] },
  { field: 'assigned_department',   queryEnabled: true,  aliases: ['assigned department', 'assigned dept', 'assigned to'] },
  { field: 'created_by_department', queryEnabled: true,  aliases: ['created by department', 'created by dept', 'source dept'] },
  { field: 'completed_by_department',queryEnabled: true, aliases: ['completed by department', 'completed dept', 'done by'] },
  { field: 'location',              queryEnabled: true,  aliases: ['location', 'room', 'area', 'place'] },
  { field: 'hotel_code',            queryEnabled: true,  aliases: ['hotel', 'hotel code', 'property'] },
  { field: 'created_date',          queryEnabled: true,  aliases: ['created date', 'created datetime', 'creation date', 'daily', 'monthly'] },
  { field: 'completed_date',        queryEnabled: true,  aliases: ['completed date', 'completion date', 'done date'] },
  { field: 'acknowledged_date',     queryEnabled: true,  aliases: ['acknowledged date', 'ack date', 'response date'] },
  { field: 'response_time_min',     queryEnabled: true,  aliases: ['response time', 'response minutes', 'avg response'] },
  { field: 'resolution_time_min',   queryEnabled: true,  aliases: ['resolution time', 'resolution minutes', 'avg resolution'] },
  { field: 'sla_breach',            queryEnabled: true,  aliases: ['sla breach', 'sla', 'sla compliance', 'breach'] },
  { field: 'timeout_flag',          queryEnabled: true,  aliases: ['timeout', 'timed out', 'timeout rate'] },
  { field: 'escalation_flag',       queryEnabled: true,  aliases: ['escalation', 'escalated', 'escalation rate'] },
  { field: 'reassignment_flag',     queryEnabled: true,  aliases: ['reassignment', 'reassigned', 'reassignment rate'] },
  { field: 'overdue_flag',          queryEnabled: true,  aliases: ['overdue', 'delayed', 'overdue jobs'] },
  { field: 'vip_flag',              queryEnabled: true,  aliases: ['vip', 'vip job', 'vip order'] },
  { field: 'quantity',              queryEnabled: true,  aliases: ['quantity', 'qty', 'total quantity'] },
  { field: 'delay_min',             queryEnabled: true,  aliases: ['delay minutes', 'delay', 'overdue minutes'] },
  { field: 'chain_code',            queryEnabled: false, aliases: ['chain', 'chain code', 'brand'] },
];

// ── MO Field Legend ──────────────────────────────────────────────────────────
const MO_FIELD_LEGEND: Array<{ field: string; queryEnabled: boolean; aliases: string[] }> = [
  { field: 'work_order_id',   queryEnabled: true,  aliases: ['work order id', 'order id', 'wo id'] },
  { field: 'status',          queryEnabled: true,  aliases: ['status', 'job status', 'state'] },
  { field: 'category',        queryEnabled: true,  aliases: ['category', 'categories', 'issue type'] },
  { field: 'asset',           queryEnabled: true,  aliases: ['asset', 'asset code', 'equipment', 'defect'] },
  { field: 'location',        queryEnabled: true,  aliases: ['location', 'room', 'area', 'place'] },
  { field: 'severity',        queryEnabled: true,  aliases: ['severity', 'priority', 'criticality'] },
  { field: 'guest_related',   queryEnabled: true,  aliases: ['guest related', 'guest request', 'guest issue'] },
  { field: 'department',      queryEnabled: true,  aliases: ['department', 'dept', 'team', 'assigned to'] },
  { field: 'hotel_code',      queryEnabled: true,  aliases: ['hotel', 'hotel code', 'property'] },
  { field: 'created_date',    queryEnabled: true,  aliases: ['created date', 'open date', 'daily', 'monthly'] },
  { field: 'completed_date',  queryEnabled: true,  aliases: ['completed date', 'closed date', 'done date'] },
  { field: 'open_duration_min',queryEnabled: true, aliases: ['open duration', 'duration minutes', 'resolution time'] },
  { field: 'cancelled_flag',  queryEnabled: true,  aliases: ['cancelled', 'canceled', 'cancellation rate'] },
  { field: 'chain_code',      queryEnabled: false, aliases: ['chain', 'chain code', 'brand'] },
];

// ── CO Field Legend ──────────────────────────────────────────────────────────
const CO_FIELD_LEGEND: Array<{ field: string; queryEnabled: boolean; aliases: string[] }> = [
  { field: 'order_id',         queryEnabled: true,  aliases: ['order id', 'cleaning order id', 'co id'] },
  { field: 'status',           queryEnabled: true,  aliases: ['status', 'cleaning status', 'state'] },
  { field: 'room_no',          queryEnabled: true,  aliases: ['room no', 'room number', 'room'] },
  { field: 'room_type',        queryEnabled: true,  aliases: ['room type', 'room category', 'room class'] },
  { field: 'stay_status',      queryEnabled: true,  aliases: ['stay status', 'occupancy', 'check-in check-out'] },
  { field: 'cleaning_type',    queryEnabled: true,  aliases: ['cleaning type', 'clean type', 'service type'] },
  { field: 'attendant',        queryEnabled: true,  aliases: ['attendant', 'housekeeper', 'cleaner', 'staff'] },
  { field: 'floor',            queryEnabled: true,  aliases: ['floor', 'floor number', 'level'] },
  { field: 'hotel_code',       queryEnabled: true,  aliases: ['hotel', 'hotel code', 'property'] },
  { field: 'start_time',       queryEnabled: true,  aliases: ['start time', 'start date', 'begin time'] },
  { field: 'end_time',         queryEnabled: true,  aliases: ['end time', 'end date', 'finish time'] },
  { field: 'duration_min',     queryEnabled: true,  aliases: ['duration', 'duration minutes', 'cleaning duration', 'avg duration'] },
  { field: 'on_time_flag',     queryEnabled: true,  aliases: ['on time', 'on-time', 'delayed', 'on-time rate'] },
  { field: 'reclean_flag',     queryEnabled: true,  aliases: ['reclean', 're-clean', 'reclean rate', 'redo'] },
  { field: 'inspection_result',queryEnabled: true,  aliases: ['inspection result', 'inspection', 'inspection pass', 'pass fail'] },
  { field: 'created_date',     queryEnabled: true,  aliases: ['created date', 'cleaning date', 'daily', 'monthly'] },
  { field: 'chain_code',       queryEnabled: false, aliases: ['chain', 'chain code', 'brand'] },
];
const CHART_TYPE_ALIASES: Array<{ chartType: string; aliases: string[] }> = [
  { chartType: 'column', aliases: ['column', 'vertical bar'] },
  { chartType: 'bar', aliases: ['bar', 'horizontal bar', 'top'] },
  { chartType: 'line', aliases: ['line', 'trend'] },
  { chartType: 'pie', aliases: ['pie', 'donut'] },
  { chartType: 'stacked', aliases: ['stacked column', 'stacked bar', 'stacked'] },
  { chartType: 'drilldown', aliases: ['drilldown', 'drill down'] },
  { chartType: '2-axis combo', aliases: ['2-axis', 'two-axis', 'dual axis', 'combo'] },
  { chartType: 'scatter', aliases: ['scatter'] },
  { chartType: 'bubble', aliases: ['bubble'] },
  { chartType: 'gauge', aliases: ['gauge', 'meter', 'kpi'] },
  { chartType: 'heatmap', aliases: ['heatmap'] },
  { chartType: 'treemap', aliases: ['treemap'] },
  { chartType: 'donut race', aliases: ['donut race'] },
  { chartType: 'bar race', aliases: ['bar race'] },
];

// ─────────────────────────────────────────────────────────────────────────────
// MODULE_TEMPLATES  — KPI / Hotel / Corp groups per module
// Labels mirror the Configuration panel (dash-config-defs.ts) chart IDs & names.
// ─────────────────────────────────────────────────────────────────────────────

const MODULE_TEMPLATES: Record<ModuleKey, TemplateGroup> = {
  // ── Job Order ─────────────────────────────────────────────────────────────
  jo: {
    kpis: [
      { label: '[kpi_01] Total Job Orders',       moduleCode: 'jo', prompt: 'show kpi total job orders' },
      { label: '[kpi_02] Completion Rate',          moduleCode: 'jo', prompt: 'show kpi job order completion rate gauge' },
      { label: '[kpi_03] SLA Compliance',           moduleCode: 'jo', prompt: 'show kpi sla compliance rate gauge' },
      { label: '[kpi_04] Timeout Rate',             moduleCode: 'jo', prompt: 'show kpi timeout rate gauge' },
      { label: '[kpi_05] Escalation Rate',          moduleCode: 'jo', prompt: 'show kpi escalation rate gauge' },
      { label: '[kpi_06] Reassignment Rate',        moduleCode: 'jo', prompt: 'show kpi reassignment rate gauge' },
      { label: '[kpi_07] Avg Response (min)',        moduleCode: 'jo', prompt: 'show kpi average response time minutes' },
      { label: '[kpi_08] P90 Response (min)',        moduleCode: 'jo', prompt: 'show kpi p90 response time minutes' },
      { label: '[kpi_09] Avg Resolution (min)',      moduleCode: 'jo', prompt: 'show kpi average resolution time minutes' },
      { label: '[kpi_10] Total Quantity',            moduleCode: 'jo', prompt: 'show kpi total job order quantity' },
    ],
    hotel: [
      { label: '[jo-01] Cumulative Weekly Service Category Share',       moduleCode: 'jo', prompt: 'show cumulative weekly service category share donut race' },
      { label: '[jo-02] SLA vs Jobs by Week',                            moduleCode: 'jo', prompt: 'show sla compliance vs jobs by week dual axis' },
      { label: '[jo-03] Closing Rate vs Jobs by Week',                   moduleCode: 'jo', prompt: 'show closing rate vs jobs by week dual axis' },
      { label: '[jo-04] Status → Service Category',                      moduleCode: 'jo', prompt: 'show job status to service category drilldown' },
      { label: '[jo-05] Service Category → Service Items',               moduleCode: 'jo', prompt: 'show service category to service items drilldown' },
      { label: '[jo-06] JO Closing Rate vs Jobs Trend',                  moduleCode: 'jo', prompt: 'show jo closing rate vs jobs trend by week' },
      { label: '[jo-07] SLA Compliance vs Jobs Trend',                   moduleCode: 'jo', prompt: 'show sla compliance vs jobs trend by week' },
      { label: '[jo-08] Timeout Trend',                                  moduleCode: 'jo', prompt: 'show timeout trend by week as line' },
      { label: '[jo-09] Status vs Top 10 Departments',                   moduleCode: 'jo', prompt: 'show job status vs top 10 departments stacked bar' },
      { label: '[jo-10] Top 10 Service Category Volume',                 moduleCode: 'jo', prompt: 'top 10 service categories by volume as bar' },
      { label: '[jo-11] Top 10 Service Item Volume',                     moduleCode: 'jo', prompt: 'top 10 service items by volume as bar' },
      { label: '[jo-12] Top 10 Assigned Department Volume',              moduleCode: 'jo', prompt: 'top 10 assigned departments by job volume as bar' },
      { label: '[jo-13] Top 10 Created By Department Volume',            moduleCode: 'jo', prompt: 'top 10 created by departments by job volume as bar' },
      { label: '[jo-14] Top 10 Completed Department Volume',             moduleCode: 'jo', prompt: 'top 10 completed departments by job volume as bar' },
      { label: '[jo-15] Top Location Volume',                            moduleCode: 'jo', prompt: 'top locations by job volume as bar' },
      { label: '[jo-16] Escalation by Department',                       moduleCode: 'jo', prompt: 'show escalation rate by department as bar' },
      { label: '[jo-17] Reassignment by Department',                     moduleCode: 'jo', prompt: 'show reassignment rate by department as bar' },
      { label: '[jo-18] SLA Breach Minutes by Service Category',         moduleCode: 'jo', prompt: 'show sla breach minutes by service category to items drilldown' },
      { label: '[jo-19] Escalation by Service Category',                 moduleCode: 'jo', prompt: 'show escalation by service category to items drilldown' },
      { label: '[jo-20] Top Reassignment by Department',                 moduleCode: 'jo', prompt: 'top reassignment by department as bar' },
      { label: '[jo-21] Resolution Time by Department',                  moduleCode: 'jo', prompt: 'show resolution time by department as bar' },
      { label: '[jo-22] Resolution P90 by Service Category',             moduleCode: 'jo', prompt: 'show resolution p90 by service category to items drilldown' },
      { label: '[jo-23] 24-Hour Completed Jobs → Completion Duration',   moduleCode: 'jo', prompt: 'show 24 hour completed jobs completion duration distribution' },
      { label: '[jo-24] 24-Hour Acknowledged Jobs → Response Duration',  moduleCode: 'jo', prompt: 'show 24 hour acknowledged jobs response duration distribution' },
      { label: '[jo-25] 24-Hour Escalated Jobs → Overdue Duration',      moduleCode: 'jo', prompt: 'show 24 hour escalated jobs overdue duration distribution' },
      { label: '[jo-26] 24-Hour Jobs Distribution → Top Item Category',  moduleCode: 'jo', prompt: 'show 24 hour jobs distribution by top item category' },
      { label: '[jo-27] Job Status → 24-Hour Jobs Distribution',         moduleCode: 'jo', prompt: 'show job status to 24 hour distribution bar drilldown' },
      { label: '[jo-28] Overdue Jobs by Item Category → 24-Hour',        moduleCode: 'jo', prompt: 'show overdue jobs by item category 24 hour distribution drilldown' },
    ],
    corp: [
      { label: '[cjo-01] Total Jobs by Hotel → Top Service Category',    moduleCode: 'jo', prompt: 'show total jobs by hotel to top service category drilldown' },
      { label: '[cjo-02] Total Jobs by Hotel → Job Status',              moduleCode: 'jo', prompt: 'show total jobs by hotel to job status drilldown' },
      { label: '[cjo-03] SLA Compliance by Hotel',                       moduleCode: 'jo', prompt: 'show sla compliance rate by hotel as bar' },
      { label: '[cjo-04] Timeout Rate by Hotel',                         moduleCode: 'jo', prompt: 'show timeout rate by hotel as bar' },
      { label: '[cjo-05] Escalation Rate by Hotel',                      moduleCode: 'jo', prompt: 'show escalation rate by hotel as bar' },
      { label: '[cjo-06] Worldmap Job Order by Hotel',                   moduleCode: 'jo', prompt: 'show worldmap job order volume by hotel' },
      { label: '[cjo-07] Reassignment Rate by Hotel',                    moduleCode: 'jo', prompt: 'show reassignment rate by hotel as bar' },
      { label: '[cjo-08] Avg Response Minutes by Hotel',                 moduleCode: 'jo', prompt: 'show average response minutes by hotel as bar' },
      { label: '[cjo-09] P90 Response Minutes by Hotel',                 moduleCode: 'jo', prompt: 'show p90 response minutes by hotel as bar' },
      { label: '[cjo-10] Avg Resolution Minutes by Hotel',               moduleCode: 'jo', prompt: 'show average resolution minutes by hotel as bar' },
      { label: '[cjo-11] Total Quantity by Hotel',                       moduleCode: 'jo', prompt: 'show total job quantity by hotel as bar' },
      { label: '[cjo-12] Delayed Status by Hotel → 24-Hour',             moduleCode: 'jo', prompt: 'show delayed jobs by hotel 24 hour distribution bar drilldown' },
      { label: '[cjo-13] Completed Status by Hotel → 24-Hour',           moduleCode: 'jo', prompt: 'show completed jobs by hotel 24 hour distribution bar drilldown' },
      { label: '[cjo-14] Timeout Status by Hotel → 24-Hour',             moduleCode: 'jo', prompt: 'show timeout jobs by hotel 24 hour distribution bar drilldown' },
      { label: '[cjo-15] Status Mix by Hotel',                           moduleCode: 'jo', prompt: 'show job status mix by hotel stacked bar' },
      { label: '[cjo-16] Top Service Categories by Hotel',               moduleCode: 'jo', prompt: 'show top service categories by hotel stacked bar' },
      { label: '[cjo-17] Top Service Items by Hotel',                    moduleCode: 'jo', prompt: 'show top service items by hotel stacked bar' },
      { label: '[cjo-18] Department Load by Hotel',                      moduleCode: 'jo', prompt: 'show department load by hotel stacked bar' },
      { label: '[cjo-19] Assigned Department Load by Hotel',             moduleCode: 'jo', prompt: 'show assigned department load by hotel stacked bar' },
      { label: '[cjo-20] Created By Department Demand by Hotel',         moduleCode: 'jo', prompt: 'show created by department demand by hotel stacked bar' },
      { label: '[cjo-21] Completed By Department Throughput by Hotel',   moduleCode: 'jo', prompt: 'show completed by department throughput by hotel stacked bar' },
      { label: '[cjo-22] 24-Hour VIP Jobs Distribution → Top Items',     moduleCode: 'jo', prompt: 'show 24 hour vip jobs distribution to top service items drilldown' },
      { label: '[cjo-23] 24-Hour Completed Jobs → Completion Duration',  moduleCode: 'jo', prompt: 'show 24 hour completed jobs completion duration range by hotel' },
      { label: '[cjo-24] 24-Hour Acknowledged Jobs → Response Time',     moduleCode: 'jo', prompt: 'show 24 hour acknowledged jobs response time distribution by hotel' },
      { label: '[cjo-25] 24-Hour Escalated Jobs → Overdue Duration',     moduleCode: 'jo', prompt: 'show 24 hour escalated jobs overdue duration distribution by hotel' },
      { label: '[cjo-26] 24-Hour Jobs Distribution → Top Item Category', moduleCode: 'jo', prompt: 'show 24 hour jobs distribution top item category by hotel' },
      { label: '[cjo-27] Job Status → 24-Hour Jobs Distribution',        moduleCode: 'jo', prompt: 'show corp job status 24 hour distribution bar drilldown' },
      { label: '[cjo-28] Overdue Jobs by Item Category → 24-Hour',       moduleCode: 'jo', prompt: 'show corp overdue jobs by item category 24 hour distribution drilldown' },
    ],
  },

  // ── Maintenance Order ─────────────────────────────────────────────────────
  mo: {
    kpis: [
      { label: '[mo_total_orders] Total Work Orders',     moduleCode: 'mo', prompt: 'show kpi total work orders' },
      { label: '[mo_completion_rate] Completion Rate',    moduleCode: 'mo', prompt: 'show kpi work order completion rate gauge' },
      { label: '[mo_open_rate] Open Work Order Rate',     moduleCode: 'mo', prompt: 'show kpi open work order rate gauge' },
      { label: '[mo_cancelled_rate] Cancelled Order Rate',moduleCode: 'mo', prompt: 'show kpi cancelled order rate gauge' },
      { label: '[mo_guest_related] Guest Related Orders', moduleCode: 'mo', prompt: 'show kpi guest related orders gauge' },
      { label: '[mo_severity_index] Severity Index',      moduleCode: 'mo', prompt: 'show kpi severity index gauge' },
      { label: '[mo_peak_category] Top Category Share',   moduleCode: 'mo', prompt: 'show kpi top category share gauge' },
      { label: '[mo_unique_categories] Active Categories',moduleCode: 'mo', prompt: 'show kpi active categories count' },
      { label: '[mo_unique_assets] Touched Assets',       moduleCode: 'mo', prompt: 'show kpi touched assets count' },
      { label: '[mo_daily_average] Daily Average Orders', moduleCode: 'mo', prompt: 'show kpi daily average work orders' },
      { label: '[mo_pending_cases] Open Orders',          moduleCode: 'mo', prompt: 'show kpi open work orders pending cases' },
      { label: '[mo_category_span] Category Coverage',    moduleCode: 'mo', prompt: 'show kpi category coverage span' },
      { label: '[cmo_kpi_01] Corp — Total Work Orders',   moduleCode: 'mo', prompt: 'show corp kpi total work orders' },
      { label: '[cmo_kpi_02] Corp — Completion Rate',     moduleCode: 'mo', prompt: 'show corp kpi completion rate gauge' },
      { label: '[cmo_kpi_03] Corp — Open Work Order Rate',moduleCode: 'mo', prompt: 'show corp kpi open work order rate gauge' },
      { label: '[cmo_kpi_04] Corp — Cancelled Order Rate',moduleCode: 'mo', prompt: 'show corp kpi cancelled order rate gauge' },
      { label: '[cmo_kpi_05] Corp — Guest Related Share', moduleCode: 'mo', prompt: 'show corp kpi guest related share gauge' },
      { label: '[cmo_kpi_06] Corp — Severity Index',      moduleCode: 'mo', prompt: 'show corp kpi severity index gauge' },
      { label: '[cmo_kpi_07] Corp — Top Category Share',  moduleCode: 'mo', prompt: 'show corp kpi top category share gauge' },
      { label: '[cmo_kpi_08] Corp — Active Categories',   moduleCode: 'mo', prompt: 'show corp kpi active categories count' },
      { label: '[cmo_kpi_09] Corp — Touched Assets',      moduleCode: 'mo', prompt: 'show corp kpi touched assets count' },
      { label: '[cmo_kpi_10] Corp — Daily Average Orders',moduleCode: 'mo', prompt: 'show corp kpi daily average work orders' },
    ],
    hotel: [
      { label: '[mo-01] Total Work Orders → Top Category',moduleCode: 'mo', prompt: 'show total work orders to top category drilldown' },
      { label: '[mo-02] Total Work Orders → Job Status',  moduleCode: 'mo', prompt: 'show total work orders to job status drilldown' },
      { label: '[mo-03] Daily Work Order Trend',          moduleCode: 'mo', prompt: 'show daily work order trend as line' },
      { label: '[mo-04] Completion Rate',                 moduleCode: 'mo', prompt: 'show work order completion rate gauge' },
      { label: '[mo-05] Open Work Order Rate',            moduleCode: 'mo', prompt: 'show open work order rate gauge' },
      { label: '[mo-06] Worldmap Maintenance',            moduleCode: 'mo', prompt: 'show worldmap maintenance orders by location' },
      { label: '[mo-07] Guest Related Orders',            moduleCode: 'mo', prompt: 'show guest related orders as pie' },
      { label: '[mo-08] Severity Index',                  moduleCode: 'mo', prompt: 'show severity index gauge' },
      { label: '[mo-09] Top Categories',                  moduleCode: 'mo', prompt: 'top maintenance categories as bar' },
      { label: '[mo-10] Category Concentration',          moduleCode: 'mo', prompt: 'show category concentration as treemap' },
    ],
    corp: [
      { label: '[cmo-01] Total Work Orders by Hotel → Top Category', moduleCode: 'mo', prompt: 'show total work orders by hotel to top category drilldown' },
      { label: '[cmo-02] Total Work Orders by Hotel → Job Status',   moduleCode: 'mo', prompt: 'show total work orders by hotel to job status drilldown' },
      { label: '[cmo-03] Daily Work Order Trend by Hotel',           moduleCode: 'mo', prompt: 'show daily work order trend by hotel as line' },
      { label: '[cmo-04] Completion Rate by Hotel',                  moduleCode: 'mo', prompt: 'show work order completion rate by hotel as bar' },
      { label: '[cmo-05] Open Work Order Rate by Hotel',             moduleCode: 'mo', prompt: 'show open work order rate by hotel as bar' },
      { label: '[cmo-06] Worldmap Maintenance by Hotel',             moduleCode: 'mo', prompt: 'show worldmap maintenance by hotel' },
      { label: '[cmo-07] Guest Related Orders by Hotel',             moduleCode: 'mo', prompt: 'show guest related orders by hotel as bar' },
      { label: '[cmo-08] Severity Index by Hotel',                   moduleCode: 'mo', prompt: 'show severity index by hotel as bar' },
      { label: '[cmo-09] Top Categories by Hotel',                   moduleCode: 'mo', prompt: 'show top maintenance categories by hotel stacked bar' },
      { label: '[cmo-10] Category Concentration by Hotel',           moduleCode: 'mo', prompt: 'show category concentration by hotel as treemap' },
      { label: '[cmo-11] Location Hotspots by Hotel',                moduleCode: 'mo', prompt: 'show location hotspots by hotel heatmap' },
      { label: '[cmo-12] Top Assets / Defects Across Chain',         moduleCode: 'mo', prompt: 'show top assets and defects across chain as bar' },
    ],
  },

  // ── Cleaning Order ────────────────────────────────────────────────────────
  co: {
    kpis: [
      { label: '[co_total_orders] Total Cleaning Orders',       moduleCode: 'co', prompt: 'show kpi total cleaning orders' },
      { label: '[co_completed_orders] Completed Orders',        moduleCode: 'co', prompt: 'show kpi completed cleaning orders' },
      { label: '[co_completion_rate] Completion Rate',          moduleCode: 'co', prompt: 'show kpi cleaning completion rate gauge' },
      { label: '[co_avg_duration] Avg Cleaning Duration',       moduleCode: 'co', prompt: 'show kpi average cleaning duration' },
      { label: '[co_median_duration] Median Cleaning Duration', moduleCode: 'co', prompt: 'show kpi median cleaning duration' },
      { label: '[co_on_time_rate] On-Time Completion Rate',     moduleCode: 'co', prompt: 'show kpi on-time completion rate gauge' },
      { label: '[co_delayed_orders] Delayed Orders',            moduleCode: 'co', prompt: 'show kpi delayed cleaning orders count' },
      { label: '[co_reclean_rate] Re-clean Rate',               moduleCode: 'co', prompt: 'show kpi re-clean rate gauge' },
      { label: '[co_inspection_pass_rate] Inspection Pass Rate',moduleCode: 'co', prompt: 'show kpi inspection pass rate gauge' },
      { label: '[co_productivity_score] Attendant Productivity',moduleCode: 'co', prompt: 'show kpi attendant productivity score gauge' },
    ],
    hotel: [
      { label: '[co-01] Cleaning Status → Room Type',                      moduleCode: 'co', prompt: 'show cleaning status to room type drilldown' },
      { label: '[co-02] Stay Status vs Avg Cleaning Duration',             moduleCode: 'co', prompt: 'show stay status vs average cleaning duration bar' },
      { label: '[co-03] Cleaning Duration → Attendant',                    moduleCode: 'co', prompt: 'show cleaning duration by attendant bar drilldown' },
      { label: '[co-04] 24-Hour Completion → Duration',                    moduleCode: 'co', prompt: 'show 24 hour completion to duration distribution' },
      { label: '[co-05] Avg Cleaning Duration by Cleaning Type',           moduleCode: 'co', prompt: 'show average cleaning duration by cleaning type as bar' },
      { label: '[co-06] Room Type vs Avg Cleaning Duration',               moduleCode: 'co', prompt: 'show room type vs average cleaning duration as bar' },
      { label: '[co-07] Stay Status → Cleaning Status',                    moduleCode: 'co', prompt: 'show stay status to cleaning status drilldown' },
      { label: '[co-08] Top 10 Attendants by Completed Orders',            moduleCode: 'co', prompt: 'top 10 attendants by completed cleaning orders as bar' },
      { label: '[co-09] On-Time vs Delayed Orders',                        moduleCode: 'co', prompt: 'show on-time vs delayed orders as column' },
      { label: '[co-10] Re-clean / Inspection Result Analysis',            moduleCode: 'co', prompt: 'show re-clean and inspection result analysis as pie' },
      { label: '[co-11] Daily Cleaning Order Trend',                       moduleCode: 'co', prompt: 'show daily cleaning order trend as line' },
      { label: '[co-12] On-Time/Delayed vs Avg Cleaning Duration',         moduleCode: 'co', prompt: 'show on-time delayed vs average cleaning duration' },
      { label: '[co-13] Ahead / On-Time / Behind Completion',              moduleCode: 'co', prompt: 'show ahead on-time behind completion distribution' },
      { label: '[co-14] Hour × Floor Total Completion Credit',             moduleCode: 'co', prompt: 'show hour by floor completion credit heatmap' },
      { label: '[co-15] 24-Hour Cleaning → Duration',                      moduleCode: 'co', prompt: 'show 24 hour cleaning to duration distribution' },
      { label: '[co-16] 24-Hour Cleaning → Stay Status',                   moduleCode: 'co', prompt: 'show 24 hour cleaning by stay status distribution' },
      { label: '[co-17] 24-Hour Cleaning → Cleaning Status',               moduleCode: 'co', prompt: 'show 24 hour cleaning by cleaning status distribution' },
      { label: '[co-18] 24-Hour Cleaning → Attendant',                     moduleCode: 'co', prompt: 'show 24 hour cleaning by attendant distribution' },
      { label: '[co-19] 24-Hour Cleaning → On-Time/Delayed',               moduleCode: 'co', prompt: 'show 24 hour cleaning on-time vs delayed distribution' },
      { label: '[co-20] 24-Hour Cleaning → Cleaning Type',                 moduleCode: 'co', prompt: 'show 24 hour cleaning by cleaning type distribution' },
      { label: '[co-21] Cleaning Duration → Stay Status',                  moduleCode: 'co', prompt: 'show cleaning duration by stay status bar drilldown' },
      { label: '[co-22] Cleaning Duration → Attendant',                    moduleCode: 'co', prompt: 'show cleaning duration by attendant bar drilldown' },
      { label: '[co-23] Cleaning Duration → Cleaning Type',                moduleCode: 'co', prompt: 'show cleaning duration by cleaning type bar drilldown' },
      { label: '[co-24] Cleaning Duration → Room Type',                    moduleCode: 'co', prompt: 'show cleaning duration by room type bar drilldown' },
      { label: '[co-25] 24-Hour Delayed → Stay Status',                    moduleCode: 'co', prompt: 'show 24 hour delayed orders by stay status distribution' },
      { label: '[co-26] 24-Hour Delayed → Attendant',                      moduleCode: 'co', prompt: 'show 24 hour delayed orders by attendant distribution' },
      { label: '[co-27] 24-Hour Delayed → Room Type',                      moduleCode: 'co', prompt: 'show 24 hour delayed orders by room type distribution' },
      { label: '[co-28] Stay Status → 24-Hour Cleaning Distribution',      moduleCode: 'co', prompt: 'show stay status to 24 hour cleaning distribution drilldown' },
      { label: '[co-29] Cleaning Status → 24-Hour Cleaning Distribution',  moduleCode: 'co', prompt: 'show cleaning status to 24 hour cleaning distribution drilldown' },
      { label: '[co-30] Room Type → 24-Hour Cleaning Distribution',        moduleCode: 'co', prompt: 'show room type to 24 hour cleaning distribution drilldown' },
      { label: '[co-31] On-Time/Delayed → 24-Hour Cleaning Distribution',  moduleCode: 'co', prompt: 'show on-time delayed to 24 hour cleaning distribution drilldown' },
      { label: '[co-32] Cleaning Type → 24-Hour Cleaning Distribution',    moduleCode: 'co', prompt: 'show cleaning type to 24 hour cleaning distribution drilldown' },
      { label: '[co-33] Top 10 Attendants → 24-Hour Distribution',         moduleCode: 'co', prompt: 'show top 10 attendants to 24 hour cleaning distribution drilldown' },
      { label: '[co-34] Stay Status → Cleaning Duration Distribution',     moduleCode: 'co', prompt: 'show stay status to cleaning duration distribution drilldown' },
      { label: '[co-35] Cleaning Status → Cleaning Duration Distribution', moduleCode: 'co', prompt: 'show cleaning status to cleaning duration distribution drilldown' },
      { label: '[co-36] Room Type → Cleaning Duration Distribution',       moduleCode: 'co', prompt: 'show room type to cleaning duration distribution drilldown' },
      { label: '[co-37] On-Time/Delayed → Cleaning Duration Distribution', moduleCode: 'co', prompt: 'show on-time delayed to cleaning duration distribution drilldown' },
      { label: '[co-38] Cleaning Type → Cleaning Duration Distribution',   moduleCode: 'co', prompt: 'show cleaning type to cleaning duration distribution drilldown' },
      { label: '[co-39] Top 10 Attendants → Cleaning Duration Distribution',moduleCode: 'co', prompt: 'show top 10 attendants to cleaning duration distribution drilldown' },
    ],
    corp: [
      { label: '[cco-01] Hotel → Cleaning Status',                         moduleCode: 'co', prompt: 'show hotel to cleaning status drilldown' },
      { label: '[cco-02] Hotel vs Avg Cleaning Duration',                  moduleCode: 'co', prompt: 'show hotel vs average cleaning duration as bar' },
      { label: '[cco-03] 24-Hour Completion → Duration',                   moduleCode: 'co', prompt: 'show corp 24 hour completion to duration distribution' },
      { label: '[cco-04] Hotel vs Stay Status',                            moduleCode: 'co', prompt: 'show hotel vs stay status stacked bar' },
      { label: '[cco-05] Hotel vs Room Type',                              moduleCode: 'co', prompt: 'show hotel vs room type stacked bar' },
      { label: '[cco-06] Hotel vs Completion Credit',                      moduleCode: 'co', prompt: 'show hotel vs completion credit as bar' },
      { label: '[cco-07] Top 10 Hotels by Completed Credit vs Orders',     moduleCode: 'co', prompt: 'top 10 hotels by completed credit vs orders dual axis' },
      { label: '[cco-08] On-Time vs Delayed by Hotel',                     moduleCode: 'co', prompt: 'show on-time vs delayed orders by hotel stacked bar' },
      { label: '[cco-09] Re-clean / Inspection Result Analysis',           moduleCode: 'co', prompt: 'show corp re-clean inspection result analysis by hotel' },
      { label: '[cco-10] Daily Cleaning Order Trend',                      moduleCode: 'co', prompt: 'show corp daily cleaning order trend as line' },
      { label: '[cco-11] On-Time/Delayed vs Avg Duration by Hotel',        moduleCode: 'co', prompt: 'show on-time delayed vs average cleaning duration by hotel' },
      { label: '[cco-12] Ahead / On-Time / Behind Completion',             moduleCode: 'co', prompt: 'show corp ahead on-time behind completion distribution' },
      { label: '[cco-13] Cleaning Duration → Attendant',                   moduleCode: 'co', prompt: 'show corp cleaning duration by attendant bar drilldown' },
      { label: '[cco-14] Top Attendant Credit',                            moduleCode: 'co', prompt: 'show top attendant credit treemap' },
      { label: '[cco-15] Hotel Readiness Risk Index',                      moduleCode: 'co', prompt: 'show hotel readiness risk index gauge' },
      { label: '[cco-16] Staffing Pressure by Hotel and Hour',             moduleCode: 'co', prompt: 'show staffing pressure by hotel and hour heatmap' },
      { label: '[cco-17] Quality Leakage by Hotel',                        moduleCode: 'co', prompt: 'show quality leakage by hotel as bar' },
      { label: '[cco-18] 24-Hour Cleaning → Duration',                     moduleCode: 'co', prompt: 'show corp 24 hour cleaning to duration distribution' },
      { label: '[cco-19] 24-Hour Cleaning → Stay Status',                  moduleCode: 'co', prompt: 'show corp 24 hour cleaning by stay status' },
      { label: '[cco-20] 24-Hour Cleaning → Cleaning Status',              moduleCode: 'co', prompt: 'show corp 24 hour cleaning by cleaning status' },
      { label: '[cco-21] 24-Hour Cleaning → Attendant',                    moduleCode: 'co', prompt: 'show corp 24 hour cleaning by attendant' },
      { label: '[cco-22] 24-Hour Cleaning → On-Time/Delayed',              moduleCode: 'co', prompt: 'show corp 24 hour cleaning on-time vs delayed' },
      { label: '[cco-23] 24-Hour Cleaning → Cleaning Type',                moduleCode: 'co', prompt: 'show corp 24 hour cleaning by cleaning type' },
      { label: '[cco-24] Cleaning Duration → Stay Status',                 moduleCode: 'co', prompt: 'show corp cleaning duration by stay status drilldown' },
      { label: '[cco-25] Cleaning Duration → Attendant',                   moduleCode: 'co', prompt: 'show corp cleaning duration by attendant drilldown' },
      { label: '[cco-26] Cleaning Duration → Cleaning Type',               moduleCode: 'co', prompt: 'show corp cleaning duration by cleaning type drilldown' },
      { label: '[cco-27] Cleaning Duration → Room Type',                   moduleCode: 'co', prompt: 'show corp cleaning duration by room type drilldown' },
      { label: '[cco-28] 24-Hour Delayed → Stay Status',                   moduleCode: 'co', prompt: 'show corp 24 hour delayed by stay status' },
      { label: '[cco-29] 24-Hour Delayed → Attendant',                     moduleCode: 'co', prompt: 'show corp 24 hour delayed by attendant' },
      { label: '[cco-30] 24-Hour Delayed → Room Type',                     moduleCode: 'co', prompt: 'show corp 24 hour delayed by room type' },
      { label: '[cco-31] Stay Status → 24-Hour Cleaning Distribution',     moduleCode: 'co', prompt: 'show corp stay status to 24 hour cleaning distribution drilldown' },
      { label: '[cco-32] Cleaning Status → 24-Hour Cleaning Distribution', moduleCode: 'co', prompt: 'show corp cleaning status to 24 hour cleaning distribution drilldown' },
      { label: '[cco-33] Room Type → 24-Hour Cleaning Distribution',       moduleCode: 'co', prompt: 'show corp room type to 24 hour cleaning distribution drilldown' },
      { label: '[cco-34] On-Time/Delayed → 24-Hour Cleaning Distribution', moduleCode: 'co', prompt: 'show corp on-time delayed to 24 hour cleaning distribution drilldown' },
      { label: '[cco-35] Cleaning Type → 24-Hour Cleaning Distribution',   moduleCode: 'co', prompt: 'show corp cleaning type to 24 hour cleaning distribution drilldown' },
      { label: '[cco-36] Top 10 Attendants → 24-Hour Distribution',        moduleCode: 'co', prompt: 'show corp top 10 attendants to 24 hour cleaning distribution drilldown' },
      { label: '[cco-37] Stay Status → Cleaning Duration Distribution',    moduleCode: 'co', prompt: 'show corp stay status to cleaning duration distribution drilldown' },
      { label: '[cco-38] Cleaning Status → Cleaning Duration Distribution',moduleCode: 'co', prompt: 'show corp cleaning status to cleaning duration distribution drilldown' },
      { label: '[cco-39] Room Type → Cleaning Duration Distribution',      moduleCode: 'co', prompt: 'show corp room type to cleaning duration distribution drilldown' },
      { label: '[cco-40] On-Time/Delayed → Cleaning Duration Distribution',moduleCode: 'co', prompt: 'show corp on-time delayed to cleaning duration distribution drilldown' },
      { label: '[cco-41] Cleaning Type → Cleaning Duration Distribution',  moduleCode: 'co', prompt: 'show corp cleaning type to cleaning duration distribution drilldown' },
      { label: '[cco-42] Top 10 Attendants → Cleaning Duration Distribution',moduleCode: 'co', prompt: 'show corp top 10 attendants to cleaning duration distribution drilldown' },
    ],
  },

  // ── Incident Management ───────────────────────────────────────────────────
  im: {
    kpis: [
      { label: '[hkpi_01] Total Incident Volume',              moduleCode: 'im', prompt: 'show kpi total incidents gauge' },
      { label: '[hkpi_02] Incident Volume',                    moduleCode: 'im', prompt: 'show kpi total incidents count' },
      { label: '[hkpi_03] Incident Resolution SLA Compliance', moduleCode: 'im', prompt: 'show kpi gauge closure rate' },
      { label: '[hkpi_04] Investigation Closure Quality Score',moduleCode: 'im', prompt: 'show kpi gauge investigation closure quality' },
      { label: '[hkpi_05] Incident Recovery Effectiveness',    moduleCode: 'im', prompt: 'show kpi gauge incident recovery effectiveness' },
      { label: '[hkpi_06] Closure Rate',                       moduleCode: 'im', prompt: 'show kpi gauge closure rate' },
      { label: '[hkpi_07] Critical Incident Rate',             moduleCode: 'im', prompt: 'show kpi gauge critical severity share' },
      { label: '[hkpi_08] Guest Complaint Severity Index',     moduleCode: 'im', prompt: 'show kpi gauge monthly severity pressure' },
      { label: '[hkpi_09] VIP Closure Rate',                   moduleCode: 'im', prompt: 'show kpi gauge vip incident share and closure rate' },
      { label: '[hkpi_10] VIP Guest Incident Rate',            moduleCode: 'im', prompt: 'show kpi gauge vip incident share' },
      { label: '[hkpi_11] VIP Incident Share',                 moduleCode: 'im', prompt: 'show kpi gauge vip incident share' },
      { label: '[hkpi_12] Department Incident Distribution',   moduleCode: 'im', prompt: 'show kpi gauge top department concentration' },
      { label: '[hkpi_13] Repeat Incident Hotspot Rate',       moduleCode: 'im', prompt: 'show kpi gauge repeat incident hotspot rate' },
      { label: '[hkpi_14] Repeat Incident Rate',               moduleCode: 'im', prompt: 'show kpi gauge monthly incident growth and repeat complaint rate' },
      { label: '[hkpi_15] Complaint Source Analysis',          moduleCode: 'im', prompt: 'show kpi gauge complaint source concentration' },
      { label: '[hkpi_16] Open Backlog Rate',                  moduleCode: 'im', prompt: 'show kpi gauge pending rate' },
      { label: '[hkpi_17] Pending Cases',                      moduleCode: 'im', prompt: 'show kpi gauge pending rate and total incidents' },
      { label: '[hkpi_18] Peak Incident Time Analysis',        moduleCode: 'im', prompt: 'show kpi gauge monthly incident growth and peak hour' },
      { label: '[hkpi_19] Avg First Response',                 moduleCode: 'im', prompt: 'show kpi gauge response time and closure rate' },
      { label: '[hkpi_20] Cancelled Cases',                    moduleCode: 'im', prompt: 'show kpi gauge cancelled incidents' },
      { label: '[corp_kpi_01] Corp — Corporate Risk Score',    moduleCode: 'im', prompt: 'show kpi gauge service quality risk index' },
      { label: '[corp_kpi_02] Corp — Critical Incident Rate',  moduleCode: 'im', prompt: 'show kpi gauge critical severity share' },
      { label: '[corp_kpi_03] Corp — Hotel Benchmark Index',   moduleCode: 'im', prompt: 'show kpi gauge hotel incident concentration' },
      { label: '[corp_kpi_04] Corp — VIP Incident Exposure',   moduleCode: 'im', prompt: 'show kpi gauge vip incident share' },
      { label: '[corp_kpi_05] Corp — SLA Breach Rate',         moduleCode: 'im', prompt: 'show kpi gauge pending rate' },
      { label: '[corp_kpi_06] Corp — Closure Rate',            moduleCode: 'im', prompt: 'show kpi gauge closure rate' },
      { label: '[corp_kpi_07] Corp — VIP Closure Rate',        moduleCode: 'im', prompt: 'show kpi gauge vip incident share and closure rate' },
      { label: '[corp_kpi_08] Corp — Repeat Guest Complaint',  moduleCode: 'im', prompt: 'show kpi gauge monthly incident growth and repeat complaint rate' },
      { label: '[corp_kpi_09] Corp — Total Incident Volume',   moduleCode: 'im', prompt: 'show kpi total incidents gauge' },
      { label: '[corp_kpi_10] Corp — Root Cause Concentration',moduleCode: 'im', prompt: 'show kpi gauge top category concentration' },
    ],
    hotel: [
      { label: '[im-01] Daily Incident Trend',                    moduleCode: 'im', prompt: 'show daily incident trend as line' },
      { label: '[im-02] VIP → Top 10 Incident Case',              moduleCode: 'im', prompt: 'show vip to top 10 incident case drilldown' },
      { label: '[im-03] Top 10 Department × Category Heatmap',    moduleCode: 'im', prompt: 'show heatmap incidents by department and category' },
      { label: '[im-04] Incident by Status → Department',         moduleCode: 'im', prompt: 'show incident status to department drilldown' },
      { label: '[im-05] Incident Resolution SLA Compliance',      moduleCode: 'im', prompt: 'show incident resolution sla compliance gauge' },
      { label: '[im-06] Severity Breakdown',                      moduleCode: 'im', prompt: 'top 8 incidents by severity as pie' },
      { label: '[im-07] Incident Root Cause Flow',                moduleCode: 'im', prompt: 'show incident root cause flow sankey' },
      { label: '[im-08] Category vs Status',                      moduleCode: 'im', prompt: 'top 10 incidents by category stacked column' },
      { label: '[im-09] Gauge — Closure Rate',                    moduleCode: 'im', prompt: 'show kpi gauge closure rate' },
      { label: '[im-10] Gauge — VIP Closure Rate',                moduleCode: 'im', prompt: 'show kpi gauge vip incident share and closure rate' },
      { label: '[im-11] Daily Incident Volume',                   moduleCode: 'im', prompt: 'show daily incident volume as column' },
      { label: '[im-12] Weekly Incident Volume',                  moduleCode: 'im', prompt: 'show weekly incident volume as column' },
      { label: '[im-13] Severity Weighted Incident Score',        moduleCode: 'im', prompt: 'show severity weighted incident score gauge' },
      { label: '[im-14] Monthly Incident Volume',                 moduleCode: 'im', prompt: 'show monthly incident volume as column' },
      { label: '[im-15] Incidents by Day of Week',                moduleCode: 'im', prompt: 'show incidents by day of week as column' },
      { label: '[im-16] Incident Forecast Prediction',            moduleCode: 'im', prompt: 'show monthly incidents by department 2-axis bar line combo' },
      { label: '[im-17] Closure Rate by Category',                moduleCode: 'im', prompt: 'show closure rate by category as bar' },
      { label: '[im-18] Top Incident Categories',                 moduleCode: 'im', prompt: 'top 10 incidents by category as bar' },
      { label: '[im-19] Top 15 Incident Items',                   moduleCode: 'im', prompt: 'top 15 incidents by item as bar' },
      { label: '[im-20] Category × Severity',                     moduleCode: 'im', prompt: 'top 10 incidents by category stacked column' },
      { label: '[im-21] Top 10 Rooms by Incidents',               moduleCode: 'im', prompt: 'top 10 rooms by incidents as bar' },
      { label: '[im-22] VIP Type → Top 10 Incident',              moduleCode: 'im', prompt: 'show vip type to top 10 incident drilldown' },
      { label: '[im-23] Incidents by Category',                   moduleCode: 'im', prompt: 'top 10 incidents by category as bar' },
      { label: '[im-24] Severity Distribution',                   moduleCode: 'im', prompt: 'top 8 incidents by severity as pie' },
      { label: '[im-25] Status Distribution',                     moduleCode: 'im', prompt: 'top 8 incidents by status as pie' },
      { label: '[im-26] Incident Source → Department',            moduleCode: 'im', prompt: 'show incident source to department drilldown' },
      { label: '[im-27] Incident Aging Bucket',                   moduleCode: 'im', prompt: 'show incident aging bucket as bar' },
      { label: '[im-28] Incidents by Hour of Day',                moduleCode: 'im', prompt: 'show incidents by hour of day as column' },
      { label: '[im-29] Open vs Closed SLA Breach',               moduleCode: 'im', prompt: 'show open vs closed sla breach as column' },
      { label: '[im-30] Guest Journey Incident Stage',            moduleCode: 'im', prompt: 'show guest journey incident stage funnel' },
      { label: '[im-31] Repeat Room Failure Analysis',            moduleCode: 'im', prompt: 'top 10 rooms by repeat incidents as bar' },
      { label: '[im-32] Department SLA Ranking',                  moduleCode: 'im', prompt: 'show department sla ranking as bar' },
      { label: '[im-33] Complaint Source Risk Ranking',           moduleCode: 'im', prompt: 'show complaint source risk ranking as bar' },
      { label: '[im-34] Department Incident Burden Score',        moduleCode: 'im', prompt: 'show department incident burden score as bar' },
      { label: '[im-35] Investigation Completion Quality',        moduleCode: 'im', prompt: 'show investigation completion quality gauge' },
      { label: '[im-36] VIP Repeat Incident Analysis',            moduleCode: 'im', prompt: 'show vip repeat incident analysis as bar' },
      { label: '[im-37] Booking Source Risk Analysis',            moduleCode: 'im', prompt: 'show booking source risk analysis as bar' },
      { label: '[im-38] Corporate Guest Complaint Ranking',       moduleCode: 'im', prompt: 'show corporate guest complaint ranking as bar' },
      { label: '[im-39] Shift Handover Incident Analysis',        moduleCode: 'im', prompt: 'show shift handover incident analysis as column' },
      { label: '[im-40] Incident by Status → Department',         moduleCode: 'im', prompt: 'show incident status to department bar drilldown' },
      { label: '[im-41] Severity Breakdown',                      moduleCode: 'im', prompt: 'top 8 incidents by severity as pie' },
      { label: '[im-42] Daily Incident Volume',                   moduleCode: 'im', prompt: 'show daily incident volume as column' },
      { label: '[im-43] Top Incident Categories',                 moduleCode: 'im', prompt: 'top 10 incidents by category as bar' },
      { label: '[im-44] Incident Source → Department',            moduleCode: 'im', prompt: 'show incident source to department bar drilldown' },
      { label: '[im-45] VIP Incident Share',                      moduleCode: 'im', prompt: 'show kpi gauge vip incident share' },
      { label: '[im-46] Incidents by Category',                   moduleCode: 'im', prompt: 'top 10 incidents by category as bar' },
      { label: '[im-47] Severity Distribution',                   moduleCode: 'im', prompt: 'top 8 incidents by severity as pie' },
      { label: '[im-48] Status by Hotel',                         moduleCode: 'im', prompt: 'show incident status by hotel stacked bar' },
      { label: '[im-49] Daily Incident Trend',                    moduleCode: 'im', prompt: 'show daily incident trend as line' },
      { label: '[im-50] Monthly Incident Volume',                 moduleCode: 'im', prompt: 'show monthly incident volume as column' },
      { label: '[im-51] Incidents by Day of Week',                moduleCode: 'im', prompt: 'show incidents by day of week as column' },
      { label: '[im-52] Top 15 Incident Items',                   moduleCode: 'im', prompt: 'top 15 incidents by item as bar' },
      { label: '[im-53] Top 10 Rooms by Incidents',               moduleCode: 'im', prompt: 'top 10 rooms by incidents as bar' },
      { label: '[im-54] Category × Status',                       moduleCode: 'im', prompt: 'top 10 incidents by category stacked column' },
      { label: '[im-55] Category × Severity',                     moduleCode: 'im', prompt: 'top 10 incidents by category stacked bar' },
      { label: '[im-56] Closure Rate by Category',                moduleCode: 'im', prompt: 'show closure rate by category as bar' },
      { label: '[im-57] Chain — Total Incidents by Hotel',        moduleCode: 'im', prompt: 'show total incidents by hotel as bar' },
      { label: '[im-58] Chain — Closure Rate by Hotel',           moduleCode: 'im', prompt: 'show closure rate by hotel as bar' },
      { label: '[im-59] Chain — VIP Incident Share by Hotel',     moduleCode: 'im', prompt: 'show vip incident share by hotel as bar' },
      { label: '[im-60] Chain — Avg Severity Score by Hotel',     moduleCode: 'im', prompt: 'show average severity score by hotel as bar' },
      { label: '[im-61] Chain — Category Mix by Hotel',           moduleCode: 'im', prompt: 'show incident category mix by hotel stacked bar' },
      { label: '[im-62] Chain — Pending Rate by Hotel',           moduleCode: 'im', prompt: 'show pending rate by hotel as bar' },
      { label: '[im-63] Department × Category Heatmap',           moduleCode: 'im', prompt: 'show heatmap incidents by department and category' },
      { label: '[im-64] Weekly Incident Volume',                  moduleCode: 'im', prompt: 'show weekly incident volume as column' },
      { label: '[im-65] Chain — Repeat Incident Rate by Hotel',   moduleCode: 'im', prompt: 'show repeat incident rate by hotel as bar' },
      { label: '[im-66] Incidents by Hour of Day',                moduleCode: 'im', prompt: 'show incidents by hour of day as column' },
      { label: '[im-67] Gauge — Closure Rate',                    moduleCode: 'im', prompt: 'show kpi gauge closure rate' },
      { label: '[im-68] Gauge — VIP Closure Rate',                moduleCode: 'im', prompt: 'show kpi gauge vip incident share and closure rate' },
      { label: '[im-69] Gauge — Avg Severity Score',              moduleCode: 'im', prompt: 'show kpi gauge average severity score' },
    ],
    corp: [
      { label: '[cim-01] Hotel Incident → Top 10 Incident Item',     moduleCode: 'im', prompt: 'show hotel incident to top 10 incident item drilldown' },
      { label: '[cim-02] Total Incident vs Status by Hotel',          moduleCode: 'im', prompt: 'show total incidents vs status by hotel stacked bar' },
      { label: '[cim-03] VIP Closure Rate vs VIP Incident by Hotel',  moduleCode: 'im', prompt: 'show vip closure rate vs vip incident by hotel dual axis' },
      { label: '[cim-04] Hotel Incident → Top 10 Incident Category',  moduleCode: 'im', prompt: 'show hotel incident to top 10 incident category drilldown' },
      { label: '[cim-05] Chain — Repeat Incident Rate by Hotel',      moduleCode: 'im', prompt: 'show repeat incident rate by hotel as bar' },
      { label: '[cim-06] Worldmap Incident by Hotel',                 moduleCode: 'im', prompt: 'show worldmap incident volume by hotel' },
      { label: '[cim-07] Hotel → Department',                         moduleCode: 'im', prompt: 'show hotel to department drilldown' },
      { label: '[cim-08] Hotel → Source of Complaint',                moduleCode: 'im', prompt: 'show hotel to source of complaint drilldown' },
      { label: '[cim-09] VIP vs Non-VIP by Hotel',                    moduleCode: 'im', prompt: 'show vip vs non-vip incidents by hotel stacked bar' },
      { label: '[cim-10] Hotel → Booking Source',                     moduleCode: 'im', prompt: 'show hotel to booking source drilldown' },
      { label: '[cim-11] Multi-Hotel Benchmark Scorecard',            moduleCode: 'im', prompt: 'show multi-hotel benchmark scorecard table' },
      { label: '[cim-12] Hotel Risk Ranking',                         moduleCode: 'im', prompt: 'show hotel risk ranking as bar' },
      { label: '[cim-13] Severity vs Volume Quadrant',                moduleCode: 'im', prompt: 'show severity vs volume quadrant scatter' },
      { label: '[cim-14] Regional Risk Heatmap',                      moduleCode: 'im', prompt: 'show regional risk heatmap' },
      { label: '[cim-15] Department Risk Heatmap',                    moduleCode: 'im', prompt: 'show heatmap incidents by department and severity' },
      { label: '[cim-16] Root Cause Pareto Chart',                    moduleCode: 'im', prompt: 'top 10 incidents by category 2-axis stacked bar' },
      { label: '[cim-17] Open Critical Aging Dashboard',              moduleCode: 'im', prompt: 'show open critical incident aging bucket as bar' },
      { label: '[cim-18] Hotel × Department Matrix',                  moduleCode: 'im', prompt: 'show heatmap incidents by hotel and department' },
      { label: '[cim-19] Chain Weekly Incident Trend',                moduleCode: 'im', prompt: 'show weekly incident volume as line' },
      { label: '[cim-20] Chain SLA Breach Rate by Hotel',             moduleCode: 'im', prompt: 'show sla breach rate by hotel as bar' },
    ],
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Chart-type derivation — inferred from template prompt string
// ─────────────────────────────────────────────────────────────────────────────

function deriveChartType(prompt: string): string {
  const p = prompt.toLowerCase();
  if (p.includes('donut race'))        return 'donut race';
  if (p.includes('bar race'))          return 'bar race';
  if (p.includes('donut drilldown'))   return 'donut drilldown';
  if (p.includes('drilldown') || p.includes('drill down')) return 'drilldown';
  if (p.includes('stacked bar'))       return 'stacked bar';
  if (p.includes('stacked column'))    return 'stacked column';
  if (p.includes('dual axis') || p.includes('2-axis') || p.includes('combo')) return 'dual axis';
  if (p.includes('heatmap'))           return 'heatmap';
  if (p.includes('treemap'))           return 'treemap';
  if (p.includes('scatter'))           return 'scatter';
  if (p.includes('bubble'))            return 'bubble';
  if (p.includes('sankey'))            return 'sankey';
  if (p.includes('funnel'))            return 'funnel';
  if (p.includes('worldmap') || p.includes(' map')) return 'map';
  if (p.includes('gauge') || (p.includes('kpi') && !p.includes('corp kpi') && !p.includes('hotel kpi'))) return 'gauge';
  if (p.includes('donut'))             return 'donut';
  if (p.includes('pie'))               return 'pie';
  if (p.includes(' bar') && !p.includes('column')) return 'bar';
  if (p.includes('line') || p.includes('trend'))   return 'line';
  if (p.includes('column'))            return 'column';
  return 'column';
}

// Strip .csv — keep the original dash-separated format as the display label.
// E.g. "SCL-CON-Conrad Macau-JO-MO-1w.csv" → "SCL-CON-Conrad Macau-JO-MO-1w"
function sourceLabel(s: { file_name: string }): string {
  return s.file_name.replace(/\.csv$/i, '');
}

// ─────────────────────────────────────────────────────────────────────────────
// Builder Preview Themes — Vintage / Modern / Executive
// ─────────────────────────────────────────────────────────────────────────────

interface ThemeDef {
  name: string;
  colors: string[];
  backgroundColor: string;
  fontFamily: string;
  titleColor: string;
  axisFontSize: string;
  axisLineColor: string;
  gridLineColor: string;
  labelColor: string;
  gaugeGood: string;
  gaugeWarn: string;
  gaugeBad: string;
  gaugeBg: string;
  heatmapMin: string;
  heatmapMax: string;
}

const BUILDER_THEMES: Record<ThemeKey, ThemeDef> = {
  vintage: {
    name: 'Vintage',
    colors: ['#8B6914', '#C4A35A', '#7A5C3E', '#D4A017', '#6B4226', '#A0845C'],
    backgroundColor: '#FAF7F2',
    fontFamily: 'Georgia, serif',
    titleColor: '#4A3728',
    axisFontSize: '11px',
    axisLineColor: '#C4B090',
    gridLineColor: '#EDE5D8',
    labelColor: '#6B5744',
    gaugeGood: '#8B6914',
    gaugeWarn: '#D4A017',
    gaugeBad: '#C55A10',
    gaugeBg: '#EDE5D8',
    heatmapMin: '#F4EFE8',
    heatmapMax: '#8B6914',
  },
  modern: {
    name: 'Modern',
    colors: ['#0EA5E9', '#0F766E', '#6366F1', '#EC4899', '#F59E0B', '#10B981'],
    backgroundColor: '#FFFFFF',
    fontFamily: 'Inter, system-ui, sans-serif',
    titleColor: '#0F172A',
    axisFontSize: '11px',
    axisLineColor: '#E2E8F0',
    gridLineColor: '#F1F5F9',
    labelColor: '#475569',
    gaugeGood: '#10B981',
    gaugeWarn: '#F59E0B',
    gaugeBad: '#EF4444',
    gaugeBg: '#F1F5F9',
    heatmapMin: '#EFF6FF',
    heatmapMax: '#0EA5E9',
  },
  executive: {
    name: 'Executive',
    colors: ['#1E3A5F', '#0F766E', '#C2410C', '#1D4ED8', '#7C3AED', '#059669'],
    backgroundColor: '#F8FAFC',
    fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
    titleColor: '#1E3A5F',
    axisFontSize: '11px',
    axisLineColor: '#CBD5E1',
    gridLineColor: '#E2E8F0',
    labelColor: '#334155',
    gaugeGood: '#0F766E',
    gaugeWarn: '#D97706',
    gaugeBad: '#DC2626',
    gaugeBg: '#E2E8F0',
    heatmapMin: '#F0F9FF',
    heatmapMax: '#1E3A5F',
  },
};

function applyBuilderTheme(opts: Highcharts.Options, th: ThemeDef): Highcharts.Options {
  const axisStyle: Highcharts.CSSObject = { color: th.labelColor, fontSize: th.axisFontSize };

  function patchXAxis(ax: Highcharts.XAxisOptions): Highcharts.XAxisOptions {
    return { ...ax, lineColor: th.axisLineColor, gridLineColor: th.gridLineColor, labels: { ...(ax.labels ?? {}), style: axisStyle } };
  }
  function patchYAxis(ax: Highcharts.YAxisOptions): Highcharts.YAxisOptions {
    return { ...ax, lineColor: th.axisLineColor, gridLineColor: th.gridLineColor, labels: { ...(ax.labels ?? {}), style: axisStyle } };
  }

  const rawX = opts.xAxis;
  const rawY = opts.yAxis;
  const patchedX = rawX == null ? undefined : Array.isArray(rawX) ? rawX.map(patchXAxis) : patchXAxis(rawX);
  const patchedY = rawY == null ? undefined : Array.isArray(rawY) ? rawY.map(patchYAxis) : patchYAxis(rawY as Highcharts.YAxisOptions);

  const prevSubStyle = ((opts.subtitle as Highcharts.SubtitleOptions | undefined)?.style) ?? {};
  return {
    ...opts,
    colors: th.colors,
    chart: { ...(opts.chart ?? {}), backgroundColor: th.backgroundColor, style: { fontFamily: th.fontFamily } },
    title: { ...(opts.title ?? {}), style: { color: th.titleColor, fontFamily: th.fontFamily } },
    subtitle: { ...(opts.subtitle ?? {}), style: { ...prevSubStyle, color: '#9CA9A5', fontFamily: th.fontFamily } },
    legend: { ...(opts.legend ?? {}), itemStyle: { color: th.labelColor, fontFamily: th.fontFamily } },
    ...(patchedX !== undefined ? { xAxis: patchedX } : {}),
    ...(patchedY !== undefined ? { yAxis: patchedY } : {}),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Sample preview builder — returns representative Highcharts options with
// placeholder data so users can see the chart shape before generating.
// ─────────────────────────────────────────────────────────────────────────────

function buildSamplePreview(chartType: string, title: string, themeKey: ThemeKey = 'vintage', sourceLabel?: string): Highcharts.Options {
  const th = BUILDER_THEMES[themeKey];
  const subText = sourceLabel ?? '— Sample Preview —';
  // For cases that need both a chart-UX note and the source label
  function chartSubtitle(note: string): Highcharts.SubtitleOptions {
    return { text: sourceLabel ? `${sourceLabel} · ${note}` : note, style: { color: '#9CA9A5', fontSize: '11px' } };
  }
  const base: Highcharts.Options = {
    title: { text: title },
    subtitle: { text: subText, style: { color: '#9CA9A5', fontSize: '11px' } },
    credits: { enabled: false },
    legend: { enabled: true },
  };
  const CATS5  = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon'];
  const CATS6  = ['HK', 'F&B', 'FO', 'Eng', 'Spa', 'Pool'];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul'];
  const d5  = [82, 47, 115, 63, 98];
  const d7  = [55, 72, 48, 91, 63, 84, 70];
  const d6  = [44, 91, 67, 38, 55, 73];

  switch (chartType) {
    case 'bar':
      return applyBuilderTheme({ ...base, chart: { type: 'bar' },
        xAxis: { categories: CATS5 }, yAxis: { title: { text: 'Count' } },
        series: [{ type: 'bar', name: 'Volume', colorByPoint: true, data: d5, dataLabels: { enabled: true } }] }, th);

    case 'column':
      return applyBuilderTheme({ ...base, chart: { type: 'column' },
        xAxis: { categories: MONTHS }, yAxis: { title: { text: 'Count' } },
        series: [{ type: 'column', name: 'Volume', data: d7, dataLabels: { enabled: true } }] }, th);

    case 'line':
      return applyBuilderTheme({ ...base, chart: { type: 'line' },
        xAxis: { categories: MONTHS }, yAxis: { title: { text: 'Count' } },
        series: [
          { type: 'line', name: 'Series A', data: d7 },
          { type: 'line', name: 'Series B', data: [40, 55, 62, 78, 50, 69, 80] },
        ] }, th);

    case 'pie':
      return applyBuilderTheme({ ...base, chart: { type: 'pie' },
        series: [{ type: 'pie', name: 'Share',
          data: CATS5.map((n, i) => ({ name: n, y: d5[i] })),
          dataLabels: { enabled: true, format: '{point.name}: {point.percentage:.0f}%' } }] }, th);

    case 'donut':
      return applyBuilderTheme({ ...base, chart: { type: 'pie' },
        series: [{ type: 'pie', name: 'Share', innerSize: '52%',
          data: CATS5.map((n, i) => ({ name: n, y: d5[i] })),
          dataLabels: { enabled: true, format: '{point.name}: {point.percentage:.0f}%' } }] }, th);

    case 'gauge':
      return applyBuilderTheme({ ...base, chart: { type: 'gauge' },
        pane: { startAngle: -140, endAngle: 140, background: [{ innerRadius: '60%', outerRadius: '100%', shape: 'arc', borderWidth: 0, backgroundColor: th.gaugeBg }] },
        yAxis: { min: 0, max: 100, tickInterval: 20, title: { text: 'Rate (%)' }, plotBands: [
          { from: 0,  to: 60,  color: th.gaugeBad },
          { from: 60, to: 80,  color: th.gaugeWarn },
          { from: 80, to: 100, color: th.gaugeGood },
        ] },
        series: [{ type: 'gauge', name: 'Value', data: [73], dataLabels: { format: '{y}%', style: { fontSize: '16px' } } }] }, th);

    case 'stacked bar':
      return applyBuilderTheme({ ...base, chart: { type: 'bar' }, plotOptions: { bar: { stacking: 'normal' } },
        xAxis: { categories: CATS5 }, yAxis: { title: { text: 'Count' } },
        series: [
          { type: 'bar', name: 'Open',    data: [28, 15, 42, 19, 35] },
          { type: 'bar', name: 'Closed',  data: [40, 22, 58, 34, 48] },
          { type: 'bar', name: 'Pending', data: [14,  8, 15, 10, 15] },
        ] }, th);

    case 'stacked column':
      return applyBuilderTheme({ ...base, chart: { type: 'column' }, plotOptions: { column: { stacking: 'normal' } },
        xAxis: { categories: MONTHS }, yAxis: { title: { text: 'Count' } },
        series: [
          { type: 'column', name: 'Open',    data: [18, 25, 15, 32, 20, 28, 22] },
          { type: 'column', name: 'Closed',  data: [30, 38, 28, 48, 33, 45, 38] },
          { type: 'column', name: 'Pending', data: [ 7, 10,  5, 12,  8, 11,  9] },
        ] }, th);

    case 'dual axis':
      return applyBuilderTheme({ ...base, chart: { type: 'column' },
        xAxis: { categories: MONTHS },
        yAxis: [
          { title: { text: 'Volume' } },
          { title: { text: 'Rate (%)' }, opposite: true, max: 100 },
        ],
        series: [
          { type: 'column', name: 'Volume', data: d7, yAxis: 0, dataLabels: { enabled: true } },
          { type: 'line',   name: 'Rate %', data: [68, 72, 65, 80, 70, 76, 74], yAxis: 1, marker: { enabled: true } },
        ] }, th);

    case 'drilldown':
    case 'bar drilldown':
      return applyBuilderTheme({ ...base, chart: { type: 'column' },
        subtitle: chartSubtitle('Click a bar to drill down'),
        xAxis: { categories: CATS5 }, yAxis: { title: { text: 'Count' } },
        series: [{ type: 'column', name: 'Volume', colorByPoint: true, dataLabels: { enabled: true },
          data: CATS5.map((n, i) => ({ name: n, y: d5[i], drilldown: n })) }],
        drilldown: { series: CATS5.map((n, i) => ({
          id: n, name: n, type: 'column' as const,
          data: [['Item A', 25], ['Item B', 18], ['Item C', d5[i] - 43]].filter(r => (r[1] as number) > 0),
        })) } }, th);

    case 'donut drilldown':
      return applyBuilderTheme({ ...base, chart: { type: 'pie' },
        subtitle: chartSubtitle('Click a segment to drill down'),
        series: [{ type: 'pie', name: 'Category', innerSize: '50%', dataLabels: { enabled: true, format: '{point.name}: {point.y}' },
          data: CATS5.map((n, i) => ({ name: n, y: d5[i], drilldown: n })) }],
        drilldown: { series: CATS5.map((n) => ({
          id: n, name: n, type: 'pie' as const,
          data: [['Item A', 30], ['Item B', 45], ['Item C', 25]],
        })) } }, th);

    case 'heatmap':
      return applyBuilderTheme({ ...base, chart: { type: 'heatmap' },
        xAxis: { categories: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'] },
        yAxis: { categories: CATS6, title: { text: undefined } },
        colorAxis: { min: 0, minColor: th.heatmapMin, maxColor: th.heatmapMax },
        series: [{ type: 'heatmap', name: 'Count', borderWidth: 1, dataLabels: { enabled: true, color: '#000' },
          data: [0,1,2,3,4].flatMap(x => [0,1,2,3,4,5].map(y => [x, y, Math.round(Math.abs(Math.sin(x * 7 + y * 3)) * 30 + 5)])) }] }, th);

    case 'treemap':
      return applyBuilderTheme({ ...base, chart: { type: 'treemap' },
        series: [{ type: 'treemap', colorByPoint: true,
          data: CATS6.map((n, i) => ({ name: n, value: d6[i] })),
          dataLabels: { enabled: true, useHTML: true, format: '<b>{point.name}</b><br/>{point.value}' } }] }, th);

    case 'scatter':
      return applyBuilderTheme({ ...base, chart: { type: 'scatter' },
        xAxis: { title: { text: 'Volume' } }, yAxis: { title: { text: 'Closure Rate (%)' } },
        series: [{ type: 'scatter', name: 'Departments',
          data: [[55,82],[120,68],[34,91],[89,74],[42,85],[160,60],[78,77],[25,93],[105,71],[67,79]] }] }, th);

    case 'bubble':
      return applyBuilderTheme({ ...base, chart: { type: 'bubble' }, plotOptions: { bubble: { minSize: 10, maxSize: 50 } },
        xAxis: { title: { text: 'Volume' } }, yAxis: { title: { text: 'Closure Rate (%)' } },
        series: [{ type: 'bubble', name: 'Hotels',
          data: [[55,82,20],[120,68,35],[34,91,12],[89,74,28],[42,85,18],[105,63,40]] }] }, th);

    case 'donut race':
      return applyBuilderTheme({ ...base, chart: { type: 'pie' },
        subtitle: chartSubtitle('Animated race — static sample'),
        series: [{ type: 'pie', name: 'Share', innerSize: '52%',
          data: CATS6.map((n, i) => ({ name: n, y: d6[i] })),
          dataLabels: { enabled: true, format: '{point.name}' } }] }, th);

    case 'bar race':
      return applyBuilderTheme({ ...base, chart: { type: 'bar' },
        subtitle: chartSubtitle('Animated race — static sample'),
        xAxis: { categories: CATS6 }, yAxis: { title: { text: 'Count' } },
        series: [{ type: 'bar', name: 'Score', colorByPoint: true, data: d6, dataLabels: { enabled: true } }] }, th);

    case 'funnel':
      return applyBuilderTheme({ ...base, chart: { type: 'funnel' },
        series: [{ type: 'funnel', name: 'Pipeline',
          data: [['Reported', 120], ['Assigned', 92], ['In Progress', 68], ['Resolved', 51], ['Closed', 44]],
          dataLabels: { enabled: true, format: '<b>{point.name}</b>: {point.y}' } }] }, th);

    case 'map':
    case 'sankey':
      return applyBuilderTheme({ ...base, chart: { type: 'column' },
        subtitle: chartSubtitle(`${chartType} — simplified sample`),
        xAxis: { categories: CATS5 }, yAxis: { title: { text: 'Count' } },
        series: [{ type: 'column', name: 'Volume', colorByPoint: true, data: d5, dataLabels: { enabled: true } }] }, th);

    default:
      return applyBuilderTheme({ ...base, chart: { type: 'column' },
        xAxis: { categories: CATS5 }, yAxis: { title: { text: 'Count' } },
        series: [{ type: 'column', name: 'Volume', colorByPoint: true, data: d5, dataLabels: { enabled: true } }] }, th);
  }
}

function getUserId(): string {
  if (typeof window === 'undefined') return 'anonymous';
  const k = 'fcs1_user_id';
  let v = localStorage.getItem(k);
  if (!v) {
    v = `user_${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(k, v);
  }
  return v;
}

export default function PlaygroundClient() {
  const searchParams = useSearchParams();
  const isDashboardView = searchParams.get('view') === 'dashboard-im';
  const [templateModule, setTemplateModule] = useState<ModuleKey>('im');
  const [selectedKpiTpl,   setSelectedKpiTpl]   = useState('');
  const [selectedHotelTpl, setSelectedHotelTpl] = useState('');
  const [selectedCorpTpl,  setSelectedCorpTpl]  = useState('');
  const [prompt, setPrompt] = useState('Show monthly incidents by severity');
  const [moduleCode, setModuleCode] = useState<ModuleKey>('im');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [reorderSaving, setReorderSaving] = useState(false);
  const [itemBusy, setItemBusy] = useState<Record<string, boolean>>({});
  const [generated, setGenerated] = useState<Generated | null>(null);
  const [samplePreview, setSamplePreview] = useState<Highcharts.Options | null>(null);
  const [selectedTplName, setSelectedTplName] = useState('');
  const [selectedTplType, setSelectedTplType] = useState('');
  const [saved, setSaved] = useState<SavedChart[]>([]);
  const [activeOrgId, setActiveOrgId] = useState<string>('');
  const [notice, setNotice] = useState<Notice>(null);
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [fieldLegendModule, setFieldLegendModule] = useState<ModuleKey | null>(null);
  const [showChartLegend, setShowChartLegend] = useState(false);
  const [builderTheme, setBuilderTheme] = useState<ThemeKey>('vintage');
  const [dataSources, setDataSources] = useState<DataSourceItem[]>([]);
  const [selectedSource, setSelectedSource] = useState<DataSourceItem | null>(null);
  const [sourcesLoading, setSourcesLoading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const userId = useMemo(() => getUserId(), []);
  const orgStorageKey = 'fcs1_active_org_id';
  const seq = (n: number) => String(n).padStart(2, '0');

  function showNotice(type: 'success' | 'error' | 'info', message: string) {
    setNotice({ type, message });
    window.setTimeout(() => setNotice((n) => (n?.message === message ? null : n)), 2600);
    const item: ActivityItem = { id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, ts: Date.now(), message, type };
    setActivities((prev) => [item, ...prev].slice(0, 20));
  }

  async function loadSaved() {
    const orgPart = activeOrgId ? `&organization_id=${encodeURIComponent(activeOrgId)}` : '';
    const res = await fetch(`/api/ai/charts/list?user_id=${encodeURIComponent(userId)}${orgPart}`);
    if (!res.ok) return;
    const text = await res.text();
    if (!text) return;
    const body = JSON.parse(text);
    if (!activeOrgId && typeof body.organization_id === 'string' && body.organization_id) {
      setActiveOrgId(body.organization_id);
      if (typeof window !== 'undefined') localStorage.setItem(orgStorageKey, body.organization_id);
    }
    const sorted = [...(body.charts ?? [])].sort((a: SavedChart, b: SavedChart) => {
      const ao = Number(a.display_order ?? Number.MAX_SAFE_INTEGER);
      const bo = Number(b.display_order ?? Number.MAX_SAFE_INTEGER);
      if (ao !== bo) return ao - bo;
      return a.title.localeCompare(b.title);
    });
    setSaved(sorted);
  }

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const storedOrg = localStorage.getItem(orgStorageKey);
      if (storedOrg) setActiveOrgId(storedOrg);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let mounted = true;
    async function loadHighchartsModules() {
      try {
        const [drilldown, more, solidGauge, exporting, exportData, fullScreen] = await Promise.all([
          import('highcharts/modules/drilldown'),
          import('highcharts/highcharts-more'),
          import('highcharts/modules/solid-gauge'),
          import('highcharts/modules/exporting'),
          import('highcharts/modules/export-data'),
          import('highcharts/modules/full-screen'),
        ]);
        if (!mounted) return;
        initHighchartsModule(drilldown);
        initHighchartsModule(more);
        initHighchartsModule(solidGauge);
        initHighchartsModule(exporting);
        initHighchartsModule(exportData);
        initHighchartsModule(fullScreen);
      } catch {
        // Keep page usable even if optional modules fail to load.
      }
    }
    void loadHighchartsModules();
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    void loadSaved();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrgId]);

  // Load available data sources from upload jobs
  useEffect(() => {
    setSourcesLoading(true);
    fetch('/api/ai/charts/datasources')
      .then((r) => r.json())
      .then((body: { sources?: Array<{
        upload_job_id: string; file_name: string;
        module_code: string; organization_id: string;
        chain_code: string; hotel_code: string; hotel_name: string;
        country_code: string; data_range: string; created_at: string;
      }> }) => {
        const sources: DataSourceItem[] = (body.sources ?? [])
          .filter((s) => ['im','jo','mo','co'].includes(s.module_code))
          .map((s) => ({ ...s, module_code: s.module_code as ModuleKey }));
        setDataSources(sources);
      })
      .catch(() => {})
      .finally(() => setSourcesLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-render sample preview when theme changes (if a template is selected)
  useEffect(() => {
    if (selectedTplType && selectedTplName) {
      setSamplePreview(buildSamplePreview(selectedTplType, selectedTplName, builderTheme, selectedSource ? sourceLabel(selectedSource) : undefined));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [builderTheme, selectedSource]);

  async function generateChart() {
    setLoading(true);
    setSamplePreview(null);   // clear sample so generated result takes over
    try {
      const res = await fetch('/api/ai/charts/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          module_code:  moduleCode,
          chart_name:   selectedTplName  || prompt.trim(),
          chart_type:   selectedTplType  || deriveChartType(prompt),
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'Generation failed');
      setGenerated(body);
      setActiveOrgId(body.organization_id ?? '');
      showNotice('success', 'Generated successfully.');
    } catch (e) {
      showNotice('error', e instanceof Error ? e.message : 'Generation failed');
    } finally {
      setLoading(false);
    }
  }

  async function saveChart() {
    if (!generated) return;
    setSaving(true);
    const payloadChartConfig = generated.kpis && generated.kpis.length > 0
      ? ({ kpis: generated.kpis } as unknown as Highcharts.Options)
      : generated.chart_config_json;
    const inputTitle = prompt.trim();
    const saveTitle = inputTitle.length > 0 ? inputTitle : generated.title;
    const res = await fetch('/api/ai/charts/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...generated,
        title: saveTitle,
        chart_config_json: payloadChartConfig,
        chart_note: generated.chart_note ?? '',
        chart_formula: generated.chart_formula ?? '',
        prompt,
        created_by: userId,
      }),
    });
    const body = await res.json();
    if (!res.ok) {
      showNotice('error', body.error ?? 'Save failed');
      setSaving(false);
      return;
    }
    await loadSaved();
    showNotice('success', `[${saveTitle}] added to Builder.`);
    setSaving(false);
  }

  async function publishChart(chart: SavedChart, publish: boolean) {
    setItemBusy((prev) => ({ ...prev, [chart.id]: true }));
    const res = await fetch('/api/ai/charts/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chart_id: chart.id, publish }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      showNotice('error', body.error ?? 'Publish failed');
      setItemBusy((prev) => ({ ...prev, [chart.id]: false }));
      return;
    }
    setSaved((prev) => prev.map((c) => c.id === chart.id ? { ...c, is_published: publish } : c));
    showNotice('success', publish ? `[${chart.title}] published.` : `[${chart.title}] unpublished.`);
    setItemBusy((prev) => ({ ...prev, [chart.id]: false }));
  }

  async function publishAllDashboard() {
    if (!activeOrgId) {
      showNotice('info', 'Generate a template first so organization is detected.');
      return;
    }
    setPublishing(true);
    try {
      const res = await fetch('/api/ai/charts/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organization_id: activeOrgId, module_code: moduleCode, publish: true, publish_all: true }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        showNotice('error', body.error ?? 'Publish Dashboard Builder failed');
        return;
      }
      await loadSaved();
      showNotice('success', `All draft items published for ${moduleCode.toUpperCase()}.`);
    } finally {
      setPublishing(false);
    }
  }

  async function toggleHidden(chart: SavedChart) {
    setItemBusy((prev) => ({ ...prev, [chart.id]: true }));
    const res = await fetch('/api/ai/charts/visibility', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, chart_id: chart.id, is_hidden: !chart.is_hidden }),
    });
    if (!res.ok) {
      showNotice('error', 'Failed to update visibility');
      setItemBusy((prev) => ({ ...prev, [chart.id]: false }));
      return;
    }
    await loadSaved();
    showNotice('success', chart.is_hidden ? `[${chart.title}] shown in sidebar.` : `[${chart.title}] hidden from sidebar.`);
    setItemBusy((prev) => ({ ...prev, [chart.id]: false }));
  }

  async function updateItem(chartId: string, action: 'move_up' | 'move_down' | 'remove' | 'restore') {
    setItemBusy((prev) => ({ ...prev, [chartId]: true }));
    const target = saved.find((x) => x.id === chartId);
    const targetIsKpi = target?.chart_type === 'kpi';
    let movedChartTitle = '';
    let fromOrder = -1;
    let toOrder = -1;
    let removedTitle = '';
    if (action === 'remove') {
      removedTitle = saved.find((x) => x.id === chartId)?.title ?? 'Item';
      setSaved((prev) => prev.filter((x) => x.id !== chartId));
    }
    let nextOrderedIds: string[] | null = null;
    if (action === 'move_up' || action === 'move_down') {
      const moduleItemsNow = saved.filter((x) => x.module_code === moduleCode);
      const sameTypeNow = moduleItemsNow.filter((x) => (x.chart_type === 'kpi') === targetIsKpi);
      const otherTypeNow = moduleItemsNow.filter((x) => (x.chart_type === 'kpi') !== targetIsKpi);
      const idx = sameTypeNow.findIndex((x) => x.id === chartId);
      const swapWith = action === 'move_up' ? idx - 1 : idx + 1;
      if (idx >= 0 && swapWith >= 0 && swapWith < sameTypeNow.length) {
        movedChartTitle = sameTypeNow[idx]?.title ?? 'Item';
        fromOrder = idx + 1;
        toOrder = swapWith + 1;
        const nextType = [...sameTypeNow];
        const tmp = nextType[idx];
        nextType[idx] = nextType[swapWith];
        nextType[swapWith] = tmp;
        const sameKpi = targetIsKpi ? nextType : otherTypeNow.filter((x) => x.chart_type === 'kpi');
        const sameChart = targetIsKpi ? otherTypeNow.filter((x) => x.chart_type !== 'kpi') : nextType;
        nextOrderedIds = [...sameKpi.map((x) => x.id), ...sameChart.map((x) => x.id)];
        const byId = new Map(moduleItemsNow.map((x) => [x.id, x]));
        const rebuiltModule = nextOrderedIds.map((id, i) => ({ ...(byId.get(id) as SavedChart), display_order: i + 1 }));
        const otherModule = saved.filter((x) => x.module_code !== moduleCode);
        setSaved([...rebuiltModule, ...otherModule]);
      }
    }
    const res = await fetch('/api/ai/charts/item', nextOrderedIds
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'reorder',
            chart_id: chartId,
            organization_id: activeOrgId || undefined,
            module_code: moduleCode,
            ordered_ids: nextOrderedIds,
          }),
        }
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chart_id: chartId, action }),
        });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      showNotice('error', body.error ?? 'Failed to update item');
      await loadSaved();
      setItemBusy((prev) => ({ ...prev, [chartId]: false }));
      return;
    }
    if (!nextOrderedIds || action === 'remove' || action === 'restore') {
      await loadSaved();
    }
    if (action === 'remove') showNotice('success', `[${removedTitle}] removed from Builder.`);
    if ((action === 'move_up' || action === 'move_down') && fromOrder > 0 && toOrder > 0) {
      showNotice('success', `[${movedChartTitle}] moved from sequence ${seq(fromOrder)} to ${seq(toOrder)}.`);
    }
    setItemBusy((prev) => ({ ...prev, [chartId]: false }));
  }

  async function renameItem(chart: SavedChart) {
    const newTitle = editingTitle.trim();
    if (!newTitle) {
      showNotice('error', 'Title cannot be empty.');
      return;
    }
    if (newTitle === chart.title) {
      setEditingId(null);
      setEditingTitle('');
      return;
    }
    setItemBusy((prev) => ({ ...prev, [chart.id]: true }));
    const res = await fetch('/api/ai/charts/item', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chart_id: chart.id, action: 'rename', new_title: newTitle }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      showNotice('error', body.error ?? 'Rename failed');
      setItemBusy((prev) => ({ ...prev, [chart.id]: false }));
      return;
    }
    setSaved((prev) => prev.map((c) => (c.id === chart.id ? { ...c, title: newTitle } : c)));
    showNotice('success', `Renamed to [${newTitle}].`);
    setEditingId(null);
    setEditingTitle('');
    setItemBusy((prev) => ({ ...prev, [chart.id]: false }));
  }

  async function reorderItems(nextIds: string[]) {
    if (nextIds.length === 0) return;
    const res = await fetch('/api/ai/charts/item', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'reorder',
        organization_id: activeOrgId,
        module_code: moduleCode,
        ordered_ids: nextIds,
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error ?? 'Failed to reorder items');
  }

  async function onDropItem(targetId: string) {
    if (!draggingId || draggingId === targetId) return;
    setReorderSaving(true);
    setItemBusy((prev) => ({ ...prev, [draggingId]: true }));
    try {
      const dragItem = saved.find((s) => s.id === draggingId);
      const targetItem = saved.find((s) => s.id === targetId);
      if (!dragItem || !targetItem) return;
      const dragIsKpi = dragItem.chart_type === 'kpi';
      const targetIsKpi = targetItem.chart_type === 'kpi';
      if (dragIsKpi !== targetIsKpi) return;
      const current = saved.filter((s) => s.module_code === moduleCode && ((s.chart_type === 'kpi') === dragIsKpi));
      const from = current.findIndex((s) => s.id === draggingId);
      const to = current.findIndex((s) => s.id === targetId);
      if (from < 0 || to < 0) return;
      const next = [...current];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      const movedTitle = moved.title;
      const fromOrder = from + 1;
      const toOrder = to + 1;
      const nextIds = next.map((x) => x.id);
      const moduleItemsNow = saved.filter((x) => x.module_code === moduleCode);
      const otherTypeNow = moduleItemsNow.filter((x) => (x.chart_type === 'kpi') !== dragIsKpi);
      const combinedIds = dragIsKpi
        ? [...nextIds, ...otherTypeNow.map((x) => x.id)]
        : [...otherTypeNow.map((x) => x.id), ...nextIds];
      const byId = new Map(moduleItemsNow.map((x) => [x.id, x]));
      const rebuiltModule: SavedChart[] = [];
      for (let i = 0; i < combinedIds.length; i += 1) {
        const found = byId.get(combinedIds[i]);
        if (!found) continue;
        rebuiltModule.push({ ...found, display_order: i + 1 });
      }
      const otherModule = saved.filter((x) => x.module_code !== moduleCode);
      setSaved([...rebuiltModule, ...otherModule]);
      await reorderItems(combinedIds);
      showNotice('success', `[${movedTitle}] moved from sequence ${seq(fromOrder)} to ${seq(toOrder)}.`);
    } catch (e) {
      showNotice('error', e instanceof Error ? e.message : 'Failed to reorder items');
      await loadSaved();
    } finally {
      setReorderSaving(false);
      setItemBusy((prev) => ({ ...prev, [draggingId]: false }));
      setDraggingId(null);
    }
  }

  const publishedVisible = useMemo(
    () => saved.filter((s) => (s.is_published ?? false) && !s.is_hidden),
    [saved],
  );
  const dashboardKpis = useMemo<KpiDef[]>(
    () => publishedVisible
      .filter((s) => s.chart_type === 'kpi')
      .flatMap((s) => (((s.chart_config_json as unknown as { kpis?: KpiDef[] })?.kpis) ?? [])),
    [publishedVisible],
  );
  const dashboardCharts = useMemo(
    () => publishedVisible.filter((s) => s.chart_type !== 'kpi'),
    [publishedVisible],
  );
  const moduleItems = useMemo(
    () => saved.filter((x) => x.module_code === moduleCode),
    [saved, moduleCode],
  );
  const moduleKpiItems = useMemo(
    () => moduleItems.filter((x) => x.chart_type === 'kpi'),
    [moduleItems],
  );
  const moduleChartItems = useMemo(
    () => moduleItems.filter((x) => x.chart_type !== 'kpi'),
    [moduleItems],
  );
  const generatedChartOptions = useMemo<Highcharts.Options | null>(() => {
    const candidate = generated?.chart_config_json;
    if (!candidate || typeof candidate !== 'object') return null;
    const previewTitle = prompt.trim() || generated?.title || '';
    return {
      ...candidate,
      title: {
        ...(((candidate.title as Highcharts.TitleOptions | undefined) ?? {}) as Highcharts.TitleOptions),
        text: previewTitle,
      },
      ...(selectedSource ? {
        subtitle: { text: sourceLabel(selectedSource), style: { color: '#9CA9A5', fontSize: '11px' } },
      } : {}),
    };
  }, [generated, prompt, selectedSource]);

  return (
    <div className="p-6 pb-20 space-y-6">
      {notice && (
        <div
          className="fixed right-4 top-4 z-50 px-4 py-2 rounded border shadow-sm font-mono text-xs"
          style={{
            background: '#FAF7F2',
            borderColor: notice.type === 'error' ? '#dc2626' : notice.type === 'success' ? '#0E7470' : '#C4B090',
            color: notice.type === 'error' ? '#991b1b' : '#1A1714',
          }}
        >
          {notice.message}
        </div>
      )}
      {fieldLegendModule && (() => {
        const MODULE_LABELS: Record<ModuleKey, string> = { jo: 'Job Order (JO)', mo: 'Maintenance Order (MO)', co: 'Cleaning Order (CO)', im: 'Incident Management (IM)' };
        type FieldRow = { field: string; queryEnabled: boolean; aliases: string[] };
        const MODULE_FIELDS: Record<ModuleKey, FieldRow[]> = {
          jo: JO_FIELD_LEGEND,
          mo: MO_FIELD_LEGEND,
          co: CO_FIELD_LEGEND,
          im: IM_FIELD_LEGEND.map(r => ({ ...r, queryEnabled: IM_QUERY_ENABLED_FIELDS.includes(r.field) })),
        };
        const rows = MODULE_FIELDS[fieldLegendModule];
        return (
          <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4" onClick={() => setFieldLegendModule(null)}>
            <div className="w-full max-w-3xl rounded-lg border bg-white p-4 shadow-lg" onClick={(e) => e.stopPropagation()}>
              {/* Module tab strip */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex gap-1">
                  {(['jo','mo','co','im'] as ModuleKey[]).map((m) => (
                    <button key={m} onClick={() => setFieldLegendModule(m)}
                      className={`px-3 py-1 rounded text-xs font-semibold border ${fieldLegendModule === m ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-300'}`}>
                      {m.toUpperCase()}
                    </button>
                  ))}
                </div>
                <button className="text-xs px-2 py-1 border rounded" onClick={() => setFieldLegendModule(null)}>Close</button>
              </div>
              <h2 className="text-sm font-semibold mb-1">{MODULE_LABELS[fieldLegendModule]} — Available Fields</h2>
              <p className="text-xs text-slate-500 mb-3">Use these field names or alternative words in your prompt to target specific data dimensions.</p>
              <div className="max-h-[52vh] overflow-auto border rounded">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 sticky top-0">
                    <tr>
                      <th className="text-left p-2 border-b font-semibold">Field</th>
                      <th className="text-left p-2 border-b font-semibold w-20">Queryable</th>
                      <th className="text-left p-2 border-b font-semibold">Prompt Aliases</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.field} className="hover:bg-slate-50">
                        <td className="p-2 border-b font-mono text-teal-700">{row.field}</td>
                        <td className="p-2 border-b">{row.queryEnabled ? <span className="text-teal-700 font-semibold">✓</span> : <span className="text-slate-400">—</span>}</td>
                        <td className="p-2 border-b text-slate-600">{row.aliases.join(' / ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {fieldLegendModule === 'im' && (
                <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="border rounded p-2">
                    <p className="text-xs font-semibold mb-1">Time Alias</p>
                    <p className="text-xs text-slate-600">{IM_TIME_ALIASES.join(' / ')}</p>
                  </div>
                  <div className="border rounded p-2">
                    <p className="text-xs font-semibold mb-1">Calculation Alias</p>
                    <p className="text-xs text-slate-600">{IM_CALC_ALIASES.join(' / ')}</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })()}
      {showChartLegend && (
        <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4" onClick={() => setShowChartLegend(false)}>
          <div className="w-full max-w-2xl rounded-lg border bg-white p-4 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-base font-semibold">Chart Type Alias</h2>
              <button className="text-xs px-2 py-1 border rounded" onClick={() => setShowChartLegend(false)}>Close</button>
            </div>
            <p className="text-xs text-slate-600 mb-3">Use these words to guide chart type selection.</p>
            <div className="max-h-[55vh] overflow-auto border rounded">
              <table className="w-full text-xs">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="text-left p-2 border-b">Chart Type</th>
                    <th className="text-left p-2 border-b">Query Enable</th>
                    <th className="text-left p-2 border-b">Alias</th>
                  </tr>
                </thead>
                <tbody>
                  {CHART_TYPE_ALIASES.map((row) => (
                    <tr key={row.chartType}>
                      <td className="p-2 border-b font-mono">{row.chartType}</td>
                      <td className="p-2 border-b">Yes</td>
                      <td className="p-2 border-b">{row.aliases.join(' / ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
      {isDashboardView && (
        <>
          <div className="p-4 border rounded-lg bg-white/70">
            <h1 className="text-xl font-semibold">Dashboard Builder</h1>
            <p className="text-sm text-slate-600 mt-1">Consolidated published builder items in Corp-style layout.</p>
          </div>

          {dashboardKpis.length > 0 && (
            <div className="p-4 border rounded-lg bg-white/70">
              <h2 className="font-semibold mb-3">KPI</h2>
              <div className="kpi-grid mt-0 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                {dashboardKpis.map((k, i) => <KpiCard key={`${k.id}-${i}`} kpi={k} dark={false} />)}
              </div>
            </div>
          )}

          {dashboardCharts.length > 0 && (
            <div className="p-4 border rounded-lg bg-white/70">
              <h2 className="font-semibold mb-3">Charts</h2>
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                {dashboardCharts.map((c) => (
                  <div key={c.id} className="border rounded p-3 bg-white">
                    <p className="font-medium mb-2">{c.title}</p>
                    <HighchartsReact highcharts={Highcharts} options={c.chart_config_json} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {dashboardKpis.length === 0 && dashboardCharts.length === 0 && (
            <div className="p-4 border rounded-lg bg-white/70">
              <p className="text-sm text-slate-500">No published items in Dashboard Builder.</p>
            </div>
          )}
        </>
      )}

      {!isDashboardView && (
      <>
      <div className="p-4 border rounded-lg bg-white/70">
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="text-xl font-semibold">Dashboard Builder</h1>
          <span className="text-xs text-slate-400 font-medium shrink-0">Fields:</span>
          {(['jo','mo','co','im'] as ModuleKey[]).map((m) => (
            <button key={m}
              className="inline-flex h-6 items-center justify-center rounded border px-2 text-[11px] font-semibold hover:bg-slate-100"
              title={`Available fields for ${m.toUpperCase()} module`}
              onClick={() => setFieldLegendModule(m)}
            >
              {m.toUpperCase()}
            </button>
          ))}
          <span className="text-xs text-slate-300">|</span>
          <button
            className="inline-flex h-6 items-center justify-center rounded border px-2 text-[11px] font-semibold hover:bg-slate-100"
            title="Chart type aliases"
            onClick={() => setShowChartLegend(true)}
          >
            Chart Types
          </button>
        </div>
      </div>

      <div className="p-4 border rounded-lg bg-white/70 space-y-3">
        {/* ── Data Source selector ─────────────────────────────────────── */}
        <div className="flex gap-2 items-center flex-wrap">
          <span className="text-xs font-semibold text-slate-500 shrink-0">Data Source</span>
          {sourcesLoading ? (
            <span className="text-xs text-slate-400 italic">Loading…</span>
          ) : dataSources.length === 0 ? (
            <span className="text-xs text-slate-400 italic">No data sources found</span>
          ) : (
            <select
              className={`border px-2 py-1 rounded text-sm min-w-[260px] ${selectedSource ? 'border-teal-500 text-teal-800 bg-teal-50 font-semibold' : 'border-slate-300 text-slate-700'}`}
              value={selectedSource?.upload_job_id ?? ''}
              onChange={(e) => {
                const val = e.target.value;
                if (!val) { setSelectedSource(null); return; }
                const src = dataSources.find((s) => s.upload_job_id === val) ?? null;
                setSelectedSource(src);
                if (src) {
                  setModuleCode(src.module_code);
                  setTemplateModule(src.module_code);
                  setActiveOrgId(src.organization_id);
                  if (typeof window !== 'undefined') localStorage.setItem(orgStorageKey, src.organization_id);
                  setSelectedKpiTpl('');
                  setSelectedHotelTpl('');
                  setSelectedCorpTpl('');
                  setSamplePreview(null);
                  setSelectedTplName('');
                  setSelectedTplType('');
                  setGenerated(null);
                }
              }}
            >
              <option value="">— Select data source —</option>
              {(() => {
                const chains = Array.from(new Set(dataSources.map((s) => s.chain_code))).sort();
                const modOrder: ModuleKey[] = ['im', 'jo', 'mo', 'co'];
                return chains.flatMap((chain) =>
                  modOrder.flatMap((mod) => {
                    const items = dataSources
                      .filter((s) => s.chain_code === chain && s.module_code === mod)
                      .sort((a, b) => a.hotel_code.localeCompare(b.hotel_code) || b.created_at.localeCompare(a.created_at));
                    if (items.length === 0) return [];
                    return [(
                      <optgroup key={`${chain}|${mod}`} label={`${chain}  ›  ${mod.toUpperCase()}`}>
                        {items.map((s) => (
                          <option key={s.upload_job_id} value={s.upload_job_id}>
                            {sourceLabel(s)}
                          </option>
                        ))}
                      </optgroup>
                    )];
                  })
                );
              })()}
            </select>
          )}
          {selectedSource && (
            <>
              <span className="text-xs text-teal-700 font-mono truncate max-w-[320px]" title={selectedSource.file_name}>
                {sourceLabel(selectedSource)}
              </span>
              <button
                className="text-xs px-2 py-1 border border-slate-300 rounded hover:bg-slate-50 shrink-0"
                onClick={() => setSelectedSource(null)}
                title="Clear data source"
              >
                ✕
              </button>
            </>
          )}
        </div>

        {/* ── Module selector ─────────────────────────────────────────── */}
        <div className="flex gap-2 items-center flex-wrap">
          <span className="text-xs font-semibold text-slate-500 shrink-0">Module</span>
          {(['jo','mo','co','im'] as ModuleKey[]).map((m) => (
            <button
              key={m}
              className={`px-3 py-1 rounded border text-xs font-semibold ${templateModule === m ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-700 border-slate-300'}`}
              onClick={() => {
                setTemplateModule(m);
                setSelectedKpiTpl('');
                setSelectedHotelTpl('');
                setSelectedCorpTpl('');
                setSamplePreview(null);
                setSelectedTplName('');
                setSelectedTplType('');
                setGenerated(null);
              }}
            >
              {m.toUpperCase()}
            </button>
          ))}
          <span className="text-xs text-slate-300 shrink-0">|</span>
          <span className="text-xs font-semibold text-slate-500 shrink-0">Theme</span>
          {(['vintage','modern','executive'] as ThemeKey[]).map((tk) => {
            const themeColors: Record<ThemeKey, string> = {
              vintage:   'bg-amber-50   text-amber-900  border-amber-400',
              modern:    'bg-sky-50     text-sky-900    border-sky-400',
              executive: 'bg-slate-100  text-slate-900  border-slate-500',
            };
            const activeColors: Record<ThemeKey, string> = {
              vintage:   'bg-amber-700  text-white border-amber-700',
              modern:    'bg-sky-600    text-white border-sky-600',
              executive: 'bg-slate-800  text-white border-slate-800',
            };
            return (
              <button
                key={tk}
                className={`px-3 py-1 rounded border text-xs font-semibold ${builderTheme === tk ? activeColors[tk] : themeColors[tk]}`}
                onClick={() => setBuilderTheme(tk)}
                title={`Preview theme: ${BUILDER_THEMES[tk].name}`}
              >
                {BUILDER_THEMES[tk].name}
              </button>
            );
          })}
        </div>

        {/* ── 1. KPI group ─────────────────────────────────────────────── */}
        <div className="flex gap-2 items-center">
          <select
            className="border px-2 py-2 rounded w-full"
            value={selectedKpiTpl}
            onChange={(e) => {
              const val = e.target.value;
              setSelectedKpiTpl(val);
              setSelectedHotelTpl('');
              setSelectedCorpTpl('');
              setGenerated(null);
              const idx = Number.parseInt(val, 10);
              if (Number.isNaN(idx)) return;
              const p = MODULE_TEMPLATES[templateModule].kpis[idx];
              if (!p) return;
              setModuleCode(p.moduleCode);
              setPrompt(p.prompt);
              const ct = 'gauge';
              const name = p.label.replace(/^\[.*?\]\s*/, '');
              setSelectedTplName(name);
              setSelectedTplType(ct);
              setSamplePreview(buildSamplePreview(ct, name, builderTheme, selectedSource ? sourceLabel(selectedSource) : undefined));
            }}
          >
            <option value="">① KPI Group ({MODULE_TEMPLATES[templateModule].kpis.length})</option>
            {MODULE_TEMPLATES[templateModule].kpis.map((p, idx) => (
              <option key={idx} value={String(idx)}>{p.label}  [gauge]</option>
            ))}
          </select>
        </div>

        {/* ── 2. Hotel group ───────────────────────────────────────────── */}
        <div className="flex gap-2 items-center">
          <select
            className="border px-2 py-2 rounded w-full"
            value={selectedHotelTpl}
            onChange={(e) => {
              const val = e.target.value;
              setSelectedHotelTpl(val);
              setSelectedKpiTpl('');
              setSelectedCorpTpl('');
              setGenerated(null);
              const idx = Number.parseInt(val, 10);
              if (Number.isNaN(idx)) return;
              const p = MODULE_TEMPLATES[templateModule].hotel[idx];
              if (!p) return;
              setModuleCode(p.moduleCode);
              setPrompt(p.prompt);
              const ct = deriveChartType(p.prompt);
              const name = p.label.replace(/^\[.*?\]\s*/, '');
              setSelectedTplName(name);
              setSelectedTplType(ct);
              setSamplePreview(buildSamplePreview(ct, name, builderTheme, selectedSource ? sourceLabel(selectedSource) : undefined));
            }}
          >
            <option value="">② Hotel Group ({MODULE_TEMPLATES[templateModule].hotel.length})</option>
            {MODULE_TEMPLATES[templateModule].hotel.map((p, idx) => (
              <option key={idx} value={String(idx)}>{p.label}  [{deriveChartType(p.prompt)}]</option>
            ))}
          </select>
        </div>

        {/* ── 3. Corp group ────────────────────────────────────────────── */}
        <div className="flex gap-2 items-center">
          <select
            className="border px-2 py-2 rounded w-full"
            value={selectedCorpTpl}
            onChange={(e) => {
              const val = e.target.value;
              setSelectedCorpTpl(val);
              setSelectedKpiTpl('');
              setSelectedHotelTpl('');
              setGenerated(null);
              const idx = Number.parseInt(val, 10);
              if (Number.isNaN(idx)) return;
              const p = MODULE_TEMPLATES[templateModule].corp[idx];
              if (!p) return;
              setModuleCode(p.moduleCode);
              setPrompt(p.prompt);
              const ct = deriveChartType(p.prompt);
              const name = p.label.replace(/^\[.*?\]\s*/, '');
              setSelectedTplName(name);
              setSelectedTplType(ct);
              setSamplePreview(buildSamplePreview(ct, name, builderTheme, selectedSource ? sourceLabel(selectedSource) : undefined));
            }}
          >
            <option value="">③ Corp Group ({MODULE_TEMPLATES[templateModule].corp.length})</option>
            {MODULE_TEMPLATES[templateModule].corp.map((p, idx) => (
              <option key={idx} value={String(idx)}>{p.label}  [{deriveChartType(p.prompt)}]</option>
            ))}
          </select>
        </div>

        <div className="flex gap-2 items-center">
          <select
            className="border px-2 py-1 rounded"
            value={moduleCode}
            onChange={(e) => setModuleCode(e.target.value as ModuleKey)}
          >
            <option value="im">IM</option>
            <option value="jo">JO</option>
            <option value="mo">MO</option>
            <option value="co">CO</option>
          </select>
          <input
            className="border px-3 py-2 rounded flex-1"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Ask for a chart..."
          />
          <button onClick={() => void generateChart()} className="px-4 py-2 bg-slate-900 text-white rounded" disabled={loading}>
            {loading ? (
              <span className="inline-flex items-center gap-1"><Hourglass size={12} className="animate-spin" /> Generating...</span>
            ) : 'Generate'}
          </button>
          <button onClick={() => void saveChart()} className="px-4 py-2 bg-teal-700 text-white rounded" disabled={!generated || saving}>
            {saving ? (
              <span className="inline-flex items-center gap-1"><Hourglass size={12} className="animate-spin" /> Saving...</span>
            ) : 'Save'}
          </button>
          <button onClick={() => void publishAllDashboard()} className="px-4 py-2 bg-amber-700 text-white rounded" disabled={publishing || !activeOrgId}>
            {publishing ? (
              <span className="inline-flex items-center gap-1"><Hourglass size={12} className="animate-spin" /> Publishing...</span>
            ) : 'Publish All Drafts'}
          </button>
        </div>
        {generated && <p className="text-sm text-slate-700">{generated.assistant_text}</p>}
        {generated?.chart_note && <p className="text-xs text-slate-600">Chart Notes: {generated.chart_note}</p>}
        {generated?.chart_formula && <p className="text-xs text-slate-600">Formula: {generated.chart_formula}</p>}
        {generated?.diagnostics && (
          <div className={`text-xs border rounded p-2 ${generated.diagnostics.fallback ? 'border-amber-500 bg-amber-50 text-amber-900' : 'border-slate-300 bg-white text-slate-700'}`}>
            <p>
              Rule-based parser · {generated.diagnostics.fallback ? 'Fallback applied' : 'No fallback'}
            </p>
            <p>Supported IM fields: {(generated.diagnostics.supported_fields ?? []).join(', ') || '-'}</p>
            <p>Requested fields: {(generated.diagnostics.requested_fields ?? []).join(', ') || '-'}</p>
            <p>Resolved fields: {(generated.diagnostics.resolved_fields ?? []).join(', ') || '-'}</p>
            {generated.diagnostics.fallback && (generated.diagnostics.fallback_reasons ?? []).length > 0 && (
              <p>Fallback reason: {(generated.diagnostics.fallback_reasons ?? []).join(' | ')}</p>
            )}
          </div>
        )}
      </div>

      {/* ── Sample preview (before Generate is clicked) ──────────────────── */}
      {!generated && samplePreview && (
        <div className="p-4 border rounded-lg bg-white/70">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold">
              Sample Preview
              {selectedTplType && (
                <span className="ml-2 px-2 py-0.5 rounded text-[10px] font-semibold bg-teal-100 text-teal-800 uppercase tracking-wide">
                  {selectedTplType}
                </span>
              )}
            </h2>
            <span className="text-[11px] text-slate-400 font-mono">
              {moduleCode.toUpperCase()} · {selectedTplName}
            </span>
          </div>
          <HighchartsReact highcharts={Highcharts} options={samplePreview} />
          <p className="mt-2 text-xs text-slate-400 italic">
            This is placeholder data. Click <strong>Generate</strong> to produce a real chart from your data, then <strong>Save</strong> to add it to Builder items.
          </p>
        </div>
      )}

      {/* ── Generated KPI preview ─────────────────────────────────────────── */}
      {generated?.kpis && generated.kpis.length > 0 && (
        <div className="p-4 border rounded-lg bg-white/70">
          <h2 className="font-semibold mb-3">KPI Preview</h2>
          <div className="kpi-grid mt-0 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {generated.kpis.map((k) => <KpiCard key={k.id} kpi={k} dark={false} />)}
          </div>
        </div>
      )}

      {/* ── Generated chart preview ───────────────────────────────────────── */}
      {generated && (!generated.kpis || generated.kpis.length === 0) && (
        <div className="p-4 border rounded-lg bg-white/70">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold">
              Generated Preview
              {selectedTplType && (
                <span className="ml-2 px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-200 text-slate-700 uppercase tracking-wide">
                  {selectedTplType}
                </span>
              )}
            </h2>
            <span className="text-[11px] text-slate-400 font-mono">
              {moduleCode.toUpperCase()} · {selectedTplName || prompt.trim() || generated.title}
            </span>
          </div>
          {generatedChartOptions ? (
            <>
              <HighchartsReact highcharts={Highcharts} options={generatedChartOptions} />
              <div className="mt-3 pt-2 border-t text-xs text-slate-600 space-y-1">
                <p><span className="font-semibold">Chart Notes:</span> {generated.chart_note ?? generated.assistant_text}</p>
                <p><span className="font-semibold">Formula:</span> {generated.chart_formula ?? 'COUNT(*) by selected dimension'}</p>
              </div>
            </>
          ) : (
            <p className="text-sm text-slate-500">No chart config returned for this template.</p>
          )}
        </div>
      )}

      <div className="p-4 border rounded-lg bg-white/70">
        <h2 className="font-semibold mb-3">Builder Items</h2>
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-slate-700">Builder KPI Items</h3>
          {moduleKpiItems.map((c, idx) => (
            <div
              key={c.id}
              className="flex items-center justify-between border rounded px-3 py-2"
              draggable={!itemBusy[c.id] && !reorderSaving}
              onDragStart={() => setDraggingId(c.id)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => void onDropItem(c.id)}
              onDragEnd={() => setDraggingId(null)}
            >
              <div className="flex items-start gap-3">
                <span className="cursor-grab text-slate-500 mt-1" title="Drag to reorder">
                  <GripVertical size={14} />
                </span>
                <span className="inline-flex min-w-8 justify-center rounded border border-slate-300 px-2 py-0.5 text-xs font-mono text-slate-700">
                  {String(idx + 1).padStart(2, '0')}
                </span>
                <div>
                  {editingId === c.id ? (
                    <div className="flex items-center gap-2">
                      <input
                        className="border rounded px-2 py-1 text-sm min-w-[240px]"
                        value={editingTitle}
                        onChange={(e) => setEditingTitle(e.target.value)}
                      />
                      <button className="text-xs px-2 py-1 border rounded inline-flex items-center justify-center" title="Save name" onClick={() => void renameItem(c)} disabled={!!itemBusy[c.id] || reorderSaving}>
                        <Check size={13} />
                      </button>
                      <button className="text-xs px-2 py-1 border rounded inline-flex items-center justify-center" title="Cancel edit" onClick={() => { setEditingId(null); setEditingTitle(''); }} disabled={!!itemBusy[c.id] || reorderSaving}>
                        <X size={13} />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <button className="text-xs px-2 py-1 border rounded inline-flex items-center justify-center" title="Edit name" onClick={() => { setEditingId(c.id); setEditingTitle(c.title); }} disabled={!!itemBusy[c.id] || reorderSaving}>
                        <Pencil size={13} />
                      </button>
                      <p className="font-medium">{c.title}</p>
                    </div>
                  )}
                  <p className="text-xs text-slate-500">{c.module_code.toUpperCase()} · {c.chart_type} · {c.is_published ? 'Published' : 'Draft'}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {(itemBusy[c.id] || reorderSaving) && <Hourglass size={12} className="animate-spin text-slate-500" />}
                <button className="text-xs px-2 py-1 border rounded" onClick={() => void updateItem(c.id, 'move_up')} disabled={!!itemBusy[c.id] || reorderSaving}>
                  Up
                </button>
                <button className="text-xs px-2 py-1 border rounded" onClick={() => void updateItem(c.id, 'move_down')} disabled={!!itemBusy[c.id] || reorderSaving}>
                  Down
                </button>
                <button className="text-xs px-3 py-1 border rounded" onClick={() => void publishChart(c, !c.is_published)} disabled={!!itemBusy[c.id] || reorderSaving}>
                  {c.is_published ? 'Unpublish' : 'Publish'}
                </button>
                <button className="text-xs px-3 py-1 border rounded" onClick={() => void toggleHidden(c)} disabled={!!itemBusy[c.id] || reorderSaving}>
                  {c.is_hidden ? 'Unhide in sidebar' : 'Hide from sidebar'}
                </button>
                <button className="text-xs px-3 py-1 border rounded text-red-700 inline-flex items-center gap-1" onClick={() => void updateItem(c.id, 'remove')} disabled={!!itemBusy[c.id] || reorderSaving}>
                  {itemBusy[c.id] ? <Hourglass size={12} className="animate-spin" /> : null}
                  Remove
                </button>
              </div>
            </div>
          ))}
          {moduleKpiItems.length === 0 && <p className="text-sm text-slate-500">No KPI items yet.</p>}

          <h3 className="text-sm font-semibold text-slate-700 mt-4">Builder Chart Items</h3>
          {moduleChartItems.map((c, idx) => (
            <div
              key={c.id}
              className="flex items-center justify-between border rounded px-3 py-2"
              draggable={!itemBusy[c.id] && !reorderSaving}
              onDragStart={() => setDraggingId(c.id)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => void onDropItem(c.id)}
              onDragEnd={() => setDraggingId(null)}
            >
              <div className="flex items-start gap-3">
                <span className="cursor-grab text-slate-500 mt-1" title="Drag to reorder">
                  <GripVertical size={14} />
                </span>
                <span className="inline-flex min-w-8 justify-center rounded border border-slate-300 px-2 py-0.5 text-xs font-mono text-slate-700">
                  {String(idx + 1).padStart(2, '0')}
                </span>
                <div>
                  {editingId === c.id ? (
                    <div className="flex items-center gap-2">
                      <input
                        className="border rounded px-2 py-1 text-sm min-w-[240px]"
                        value={editingTitle}
                        onChange={(e) => setEditingTitle(e.target.value)}
                      />
                      <button className="text-xs px-2 py-1 border rounded inline-flex items-center justify-center" title="Save name" onClick={() => void renameItem(c)} disabled={!!itemBusy[c.id] || reorderSaving}>
                        <Check size={13} />
                      </button>
                      <button className="text-xs px-2 py-1 border rounded inline-flex items-center justify-center" title="Cancel edit" onClick={() => { setEditingId(null); setEditingTitle(''); }} disabled={!!itemBusy[c.id] || reorderSaving}>
                        <X size={13} />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <button className="text-xs px-2 py-1 border rounded inline-flex items-center justify-center" title="Edit name" onClick={() => { setEditingId(c.id); setEditingTitle(c.title); }} disabled={!!itemBusy[c.id] || reorderSaving}>
                        <Pencil size={13} />
                      </button>
                      <p className="font-medium">{c.title}</p>
                    </div>
                  )}
                  <p className="text-xs text-slate-500">{c.module_code.toUpperCase()} · {c.chart_type} · {c.is_published ? 'Published' : 'Draft'}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {(itemBusy[c.id] || reorderSaving) && <Hourglass size={12} className="animate-spin text-slate-500" />}
                <button className="text-xs px-2 py-1 border rounded" onClick={() => void updateItem(c.id, 'move_up')} disabled={!!itemBusy[c.id] || reorderSaving}>
                  Up
                </button>
                <button className="text-xs px-2 py-1 border rounded" onClick={() => void updateItem(c.id, 'move_down')} disabled={!!itemBusy[c.id] || reorderSaving}>
                  Down
                </button>
                <button className="text-xs px-3 py-1 border rounded" onClick={() => void publishChart(c, !c.is_published)} disabled={!!itemBusy[c.id] || reorderSaving}>
                  {c.is_published ? 'Unpublish' : 'Publish'}
                </button>
                <button className="text-xs px-3 py-1 border rounded" onClick={() => void toggleHidden(c)} disabled={!!itemBusy[c.id] || reorderSaving}>
                  {c.is_hidden ? 'Unhide in sidebar' : 'Hide from sidebar'}
                </button>
                <button className="text-xs px-3 py-1 border rounded text-red-700 inline-flex items-center gap-1" onClick={() => void updateItem(c.id, 'remove')} disabled={!!itemBusy[c.id] || reorderSaving}>
                  {itemBusy[c.id] ? <Hourglass size={12} className="animate-spin" /> : null}
                  Remove
                </button>
              </div>
            </div>
          ))}
          {moduleChartItems.length === 0 && <p className="text-sm text-slate-500">No chart items yet.</p>}
          {moduleItems.length === 0 && <p className="text-sm text-slate-500">No builder items yet.</p>}
        </div>
      </div>
      </>
      )}
      {!isDashboardView && (
        <div className="fixed bottom-0 left-0 right-0 z-40 border-t bg-[#faf7f2]/95 backdrop-blur-sm">
          <div className="mx-auto max-w-screen-2xl px-4 py-2 flex items-center gap-3">
            <span className="text-[11px] font-mono text-slate-700 whitespace-nowrap">Activity</span>
            {activities.length === 0 ? (
              <span className="text-[11px] text-slate-500">No recent activity.</span>
            ) : (
              <div className="flex-1 overflow-x-auto">
                <div className="flex items-center gap-2 min-w-max">
                  {activities.slice(0, 8).map((a) => (
                    <span
                      key={a.id}
                      className="text-[11px] px-2 py-1 rounded border whitespace-nowrap"
                      style={{
                        borderColor: a.type === 'error' ? '#dc2626' : a.type === 'success' ? '#0E7470' : '#C4B090',
                        color: a.type === 'error' ? '#991b1b' : '#1A1714',
                        background: '#fff',
                      }}
                    >
                      {new Date(a.ts).toLocaleTimeString()} · {a.message}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
