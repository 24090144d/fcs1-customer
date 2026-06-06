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
  module_code: 'im' | 'jo' | 'co';
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

type QuickPattern = {
  label: string;
  moduleCode: 'im' | 'jo' | 'co';
  prompt: string;
};

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

const KPI_TEMPLATES: QuickPattern[] = [
  { label: 'Corp 01: Total Incident Volume', moduleCode: 'im', prompt: 'show kpi total incidents gauge' },
  { label: 'Corp 02: Corporate Risk Score', moduleCode: 'im', prompt: 'show kpi gauge service quality risk index' },
  { label: 'Corp 03: Critical Incident Rate', moduleCode: 'im', prompt: 'show kpi gauge critical severity share' },
  { label: 'Corp 04: Hotel Benchmark Index', moduleCode: 'im', prompt: 'show kpi gauge hotel incident concentration' },
  { label: 'Corp 05: VIP Incident Exposure', moduleCode: 'im', prompt: 'show kpi gauge vip incident share' },
  { label: 'Corp 06: SLA Breach Rate', moduleCode: 'im', prompt: 'show kpi gauge pending rate' },
  { label: 'Corp 07: Closure Rate', moduleCode: 'im', prompt: 'show kpi gauge closure rate' },
  { label: 'Corp 08: VIP Closure Rate', moduleCode: 'im', prompt: 'show kpi gauge vip incident share and closure rate' },
  { label: 'Corp 09: Repeat Guest Complaint Rate', moduleCode: 'im', prompt: 'show kpi gauge monthly incident growth and repeat complaint rate' },
  { label: 'Corp 10: Root Cause Concentration', moduleCode: 'im', prompt: 'show kpi gauge top category concentration' },

  { label: 'Hotel 01: Incident Volume', moduleCode: 'im', prompt: 'show kpi total incidents gauge' },
  { label: 'Hotel 02: Incident Resolution SLA Compliance', moduleCode: 'im', prompt: 'show kpi gauge closure rate' },
  { label: 'Hotel 03: Closure Rate', moduleCode: 'im', prompt: 'show kpi gauge closure rate' },
  { label: 'Hotel 04: Critical Incident Rate', moduleCode: 'im', prompt: 'show kpi gauge critical severity share' },
  { label: 'Hotel 05: Guest Complaint Severity Index', moduleCode: 'im', prompt: 'show kpi gauge monthly severity pressure' },
  { label: 'Hotel 06: VIP Closure Rate', moduleCode: 'im', prompt: 'show kpi gauge vip incident share and closure rate' },
  { label: 'Hotel 07: VIP Guest Incident Rate', moduleCode: 'im', prompt: 'show kpi gauge vip incident share' },
  { label: 'Hotel 08: Department Incident Distribution', moduleCode: 'im', prompt: 'show kpi gauge top department concentration' },
  { label: 'Hotel 09: Repeat Incident Rate', moduleCode: 'im', prompt: 'show kpi gauge monthly incident growth and repeat complaint rate' },
  { label: 'Hotel 10: Complaint Source Analysis', moduleCode: 'im', prompt: 'show kpi gauge complaint source concentration' },
  { label: 'Hotel 11: Open Backlog Rate', moduleCode: 'im', prompt: 'show kpi gauge pending rate' },
  { label: 'Hotel 12: Pending Cases', moduleCode: 'im', prompt: 'show kpi gauge pending rate and total incidents' },
  { label: 'Hotel 13: Peak Incident Time Analysis', moduleCode: 'im', prompt: 'show kpi gauge monthly incident growth and peak hour' },
  { label: 'Hotel 14: Avg First Response', moduleCode: 'im', prompt: 'show kpi gauge response time and closure rate' },
  { label: 'Hotel 15: Cancelled Cases', moduleCode: 'im', prompt: 'show kpi gauge cancelled incidents' },

  { label: 'Extra 01: Housekeeping Incident Share', moduleCode: 'im', prompt: 'show kpi gauge housekeeping incident share' },
  { label: 'Extra 02: Engineering Incident Share', moduleCode: 'im', prompt: 'show kpi gauge engineering incident share' },
  { label: 'Extra 03: Front Office Incident Share', moduleCode: 'im', prompt: 'show kpi gauge front office incident share' },
  { label: 'Extra 04: Booking Source Complaint Rate', moduleCode: 'im', prompt: 'show kpi gauge booking source complaint rate' },
  { label: 'Extra 05: Unknown Data Quality Rate', moduleCode: 'im', prompt: 'show kpi gauge unknown data quality rate' },
];

const CHART_TEMPLATES: QuickPattern[] = [
  { label: '[Column] Monthly incidents by severity', moduleCode: 'im', prompt: 'show monthly incidents by severity as column' },
  { label: '[Column] Monthly incidents by department', moduleCode: 'im', prompt: 'show monthly incidents by department as column' },
  { label: '[Bar] Top 10 incident categories', moduleCode: 'im', prompt: 'top 10 incidents by category as bar' },
  { label: '[Bar] Top 10 departments', moduleCode: 'im', prompt: 'top 10 incidents by department as bar' },
  { label: '[Line] Monthly incidents by source', moduleCode: 'im', prompt: 'monthly incidents by source as line' },
  { label: '[Line] Monthly incidents by booking source', moduleCode: 'im', prompt: 'monthly incidents by booking source as line' },
  { label: '[Pie] Incident status share', moduleCode: 'im', prompt: 'top 8 incidents by status as pie' },
  { label: '[Pie] Severity share', moduleCode: 'im', prompt: 'top 8 incidents by severity as pie' },
  { label: '[Donut] Department share (latest month)', moduleCode: 'im', prompt: 'show monthly incidents by department using donut' },
  { label: '[Donut] Complaint source share', moduleCode: 'im', prompt: 'top 10 incidents by source using donut' },
  { label: '[Stacked Column] Department by status', moduleCode: 'im', prompt: 'top 10 incidents by department stacked column' },
  { label: '[Stacked Column] Category by severity', moduleCode: 'im', prompt: 'top 10 incidents by category stacked column' },
  { label: '[Stacked Bar] Hotel by severity', moduleCode: 'im', prompt: 'top 10 incidents by hotel stacked bar' },
  { label: '[Stacked Bar] Country by severity', moduleCode: 'im', prompt: 'top 10 incidents by country stacked bar' },
  { label: '[Dual Axis] Monthly category combo', moduleCode: 'im', prompt: 'monthly incidents by category dual axis combo' },
  { label: '[Dual Axis] Top department combo', moduleCode: 'im', prompt: 'top 10 incidents by department dual axis' },
  { label: '[Scatter] Volume vs closure by department', moduleCode: 'im', prompt: 'show scatter by department' },
  { label: '[Scatter] Volume vs closure by category', moduleCode: 'im', prompt: 'show scatter by category' },
  { label: '[Bubble] Volume closure VIP by department', moduleCode: 'im', prompt: 'show bubble by department' },
  { label: '[Bubble] Volume closure VIP by category', moduleCode: 'im', prompt: 'show bubble by category' },
  { label: '[Gauge] Closure rate', moduleCode: 'im', prompt: 'show kpi gauge closure rate' },
  { label: '[Gauge] Pending rate', moduleCode: 'im', prompt: 'show kpi gauge pending rate' },
  { label: '[Donut Drilldown] Category to item donut', moduleCode: 'im', prompt: 'top 10 incidents by category donut drilldown' },
  { label: '[Donut Drilldown] Department to category donut', moduleCode: 'im', prompt: 'top 10 incidents by department donut drilldown' },
  { label: '[Bar Drilldown] Category to item bar', moduleCode: 'im', prompt: 'top 10 incidents by category bar drilldown' },
  { label: '[Bar Drilldown] Department to category bar', moduleCode: 'im', prompt: 'top 10 incidents by department bar drilldown' },
  { label: '[2-Axis Bar/Line] Monthly department + total', moduleCode: 'im', prompt: 'monthly incidents by department 2-axis bar line combo' },
  { label: '[2-Axis Bar/Line] Monthly severity + total', moduleCode: 'im', prompt: 'monthly incidents by severity 2-axis bar line combo' },
  { label: '[2-Axis Stacked Bar] Department stacked + running %', moduleCode: 'im', prompt: 'top 10 incidents by department 2-axis stacked bar' },
  { label: '[2-Axis Stacked Bar] Category stacked + running %', moduleCode: 'im', prompt: 'top 10 incidents by category 2-axis stacked bar' },
  { label: '[Heatmap] Hotel by department heatmap', moduleCode: 'im', prompt: 'show heatmap incidents by hotel and department' },
  { label: '[Heatmap] Department by severity heatmap', moduleCode: 'im', prompt: 'show heatmap incidents by department and severity' },
  { label: '[Treemap] Category to item treemap', moduleCode: 'im', prompt: 'show treemap incidents by category and item' },
  { label: '[Treemap] Department to category treemap', moduleCode: 'im', prompt: 'show treemap incidents by department and category' },
  { label: '[Donut Race] Monthly category donut race', moduleCode: 'im', prompt: 'show donut race monthly incidents by category' },
  { label: '[Donut Race] Monthly department donut race', moduleCode: 'im', prompt: 'show donut race monthly incidents by department' },
  { label: '[Bar Race] Monthly department bar race', moduleCode: 'im', prompt: 'show bar race monthly incidents by department' },
  { label: '[Bar Race] Monthly category bar race', moduleCode: 'im', prompt: 'show bar race monthly incidents by category' },
  { label: '[Column] Housekeeping vs Engineering monthly', moduleCode: 'im', prompt: 'show monthly incidents by department for housekeeping and engineering as column' },
  { label: '[Line] Housekeeping vs Engineering trend', moduleCode: 'im', prompt: 'show monthly incidents by department for housekeeping and engineering as line' },
];

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
  const [selectedKpiTemplate, setSelectedKpiTemplate] = useState('');
  const [selectedChartTemplate, setSelectedChartTemplate] = useState('');
  const [prompt, setPrompt] = useState('Show monthly incidents by severity');
  const [moduleCode, setModuleCode] = useState<'im' | 'jo' | 'co'>('im');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [reorderSaving, setReorderSaving] = useState(false);
  const [itemBusy, setItemBusy] = useState<Record<string, boolean>>({});
  const [generated, setGenerated] = useState<Generated | null>(null);
  const [saved, setSaved] = useState<SavedChart[]>([]);
  const [activeOrgId, setActiveOrgId] = useState<string>('');
  const [notice, setNotice] = useState<Notice>(null);
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [showFieldLegend, setShowFieldLegend] = useState(false);
  const [showChartLegend, setShowChartLegend] = useState(false);
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
    const body = await res.json();
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

  async function generateChart() {
    setLoading(true);
    try {
      const res = await fetch('/api/ai/charts/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, module_code: moduleCode }),
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
        showNotice('error', body.error ?? 'Publish Dashboard · IM failed');
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
    };
  }, [generated, prompt]);

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
      {showFieldLegend && (
        <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4" onClick={() => setShowFieldLegend(false)}>
          <div className="w-full max-w-3xl rounded-lg border bg-white p-4 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-base font-semibold">IM Field Legend</h2>
              <button className="text-xs px-2 py-1 border rounded" onClick={() => setShowFieldLegend(false)}>Close</button>
            </div>
            <p className="text-xs text-slate-600 mb-3">Use these field names or alternative words in your prompt.</p>
            <div className="max-h-[55vh] overflow-auto border rounded">
              <table className="w-full text-xs">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="text-left p-2 border-b">IM Field</th>
                    <th className="text-left p-2 border-b">Query Enable</th>
                    <th className="text-left p-2 border-b">Alias</th>
                  </tr>
                </thead>
                <tbody>
                  {IM_FIELD_LEGEND.map((row) => (
                    <tr key={row.field}>
                      <td className="p-2 border-b font-mono">{row.field}</td>
                      <td className="p-2 border-b">Yes</td>
                      <td className="p-2 border-b">{row.aliases.join(' / ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="border rounded p-2">
                <p className="text-xs font-semibold mb-1">Time Alias</p>
                <p className="text-xs text-slate-700">{IM_TIME_ALIASES.join(' / ')}</p>
              </div>
              <div className="border rounded p-2">
                <p className="text-xs font-semibold mb-1">Calculation Alias</p>
                <p className="text-xs text-slate-700">{IM_CALC_ALIASES.join(' / ')}</p>
              </div>
            </div>
          </div>
        </div>
      )}
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
            <h1 className="text-xl font-semibold">Dashboard · IM</h1>
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
              <p className="text-sm text-slate-500">No published items in Dashboard · IM.</p>
            </div>
          )}
        </>
      )}

      {!isDashboardView && (
      <>
      <div className="p-4 border rounded-lg bg-white/70">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold">Dashboard · IM</h1>
          <button
            className="inline-flex h-6 items-center justify-center rounded border px-2 text-[11px] font-semibold"
            title="Supported IM fields and aliases"
            onClick={() => setShowFieldLegend(true)}
          >
            Fields
          </button>
          <button
            className="inline-flex h-6 items-center justify-center rounded border px-2 text-[11px] font-semibold"
            title="Chart type aliases"
            onClick={() => setShowChartLegend(true)}
          >
            Charts
          </button>
        </div>
        <p className="text-sm text-slate-600 mt-1">Generate tenant-scoped IM templates, preview KPI/charts, then save to your builder menu.</p>
      </div>

      <div className="p-4 border rounded-lg bg-white/70 space-y-3">
        <div className="flex gap-2 items-center">
          <select
            className="border px-2 py-2 rounded w-full"
            value={selectedKpiTemplate}
            onChange={(e) => {
              const val = e.target.value;
              setSelectedKpiTemplate(val);
              setSelectedChartTemplate('');
              const idx = Number.parseInt(val, 10);
              if (Number.isNaN(idx)) return;
              const p = KPI_TEMPLATES[idx];
              if (!p) return;
              setModuleCode(p.moduleCode);
              setPrompt(p.prompt);
            }}
          >
            <option value="">KPI templates (30)</option>
            {KPI_TEMPLATES.map((p, idx) => (
              <option key={idx} value={String(idx)}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex gap-2 items-center">
          <select
            className="border px-2 py-2 rounded w-full"
            value={selectedChartTemplate}
            onChange={(e) => {
              const val = e.target.value;
              setSelectedChartTemplate(val);
              setSelectedKpiTemplate('');
              const idx = Number.parseInt(val, 10);
              if (Number.isNaN(idx)) return;
              const p = CHART_TEMPLATES[idx];
              if (!p) return;
              setModuleCode(p.moduleCode);
              setPrompt(p.prompt);
            }}
          >
            <option value="">Chart templates (2 examples per type)</option>
            {CHART_TEMPLATES.map((p, idx) => (
              <option key={idx} value={String(idx)}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex gap-2 items-center">
          <select
            className="border px-2 py-1 rounded"
            value={moduleCode}
            onChange={(e) => setModuleCode(e.target.value as 'im' | 'jo' | 'co')}
          >
            <option value="im">IM</option>
            <option value="jo">JO</option>
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

      {generated?.kpis && generated.kpis.length > 0 && (
        <div className="p-4 border rounded-lg bg-white/70">
          <h2 className="font-semibold mb-3">KPI Preview</h2>
          <div className="kpi-grid mt-0 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {generated.kpis.map((k) => <KpiCard key={k.id} kpi={k} dark={false} />)}
          </div>
        </div>
      )}

      {generated && (!generated.kpis || generated.kpis.length === 0) && (
        <div className="p-4 border rounded-lg bg-white/70">
          <h2 className="font-semibold mb-3">Preview: {prompt.trim() || generated.title}</h2>
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
