/**
 * refresh_all_hour_maps_current_tz.mjs
 *
 * Recomputes every stored 24-hour-distribution map (JO, MO, hotel-level IM)
 * using the organization's CURRENT timezone setting, without requiring a
 * CSV re-upload. Corp-level IM hour maps are already live-recomputed on
 * every request (see fetchCorpDashboard in lib/dashboard-fetch.ts) and are
 * not touched here.
 *
 * Usage:
 *   node scripts/refresh_all_hour_maps_current_tz.mjs [DATABASE_URL]
 *
 * Defaults to the Neon production database used by other scripts in this repo.
 */

import pg from 'pg';
const { Client } = pg;

const connectionString = process.argv[2]
  ?? 'postgresql://neondb_owner:npg_WA1yvrktU6NP@ep-square-glitter-apw48qoo.c-7.us-east-1.aws.neon.tech/neondb?sslmode=require';

const client = new Client({ connectionString });
await client.connect();

const orgTz = (await client.query(
  `SELECT COALESCE(timezone, 'UTC') AS tz FROM organizations ORDER BY created_at LIMIT 1`,
)).rows[0]?.tz ?? 'UTC';
console.log(`Using organization timezone: ${orgTz}\n`);

function localHour(d, tz) {
  try {
    const s = new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: tz }).format(d);
    const h = parseInt(s, 10);
    if (!isNaN(h)) return h === 24 ? 0 : h;
  } catch { /* fall through */ }
  return d.getUTCHours();
}

function durBucket(mins) {
  if (mins < 15) return '< 15 min';
  if (mins < 30) return '15–30 min';
  if (mins < 60) return '30–60 min';
  if (mins < 120) return '1–2 h';
  if (mins < 240) return '2–4 h';
  if (mins < 480) return '4–8 h';
  return '8+ h';
}

function parseDurationMinutes(raw) {
  const s = (raw ?? '').toString().trim();
  if (!s) return null;
  const m = s.match(/^(\d+):(\d{2})(?::(\d{2}))?$/);
  if (m) {
    const hh = parseInt(m[1], 10);
    const mm = parseInt(m[2], 10);
    const ss = m[3] ? parseInt(m[3], 10) : 0;
    return hh * 60 + mm + Math.floor(ss / 60);
  }
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

function inc(obj, key) { obj[key] = (obj[key] ?? 0) + 1; }
function inc2(obj, h, key) {
  if (!obj[h]) obj[h] = {};
  obj[h][key] = (obj[h][key] ?? 0) + 1;
}
function isVip(v) {
  if (v === null || v === undefined) return false;
  const s = String(v).trim();
  return !!s && s !== '-';
}

// ── JO ────────────────────────────────────────────────────────────────────
async function refreshJo() {
  const dashRows = (await client.query(
    `SELECT id, upload_job_id, generated_json->'meta'->>'hotel_code' AS hotel FROM jo_dashboard_json`,
  )).rows;
  console.log(`JO: ${dashRows.length} dashboard row(s)`);

  for (const dash of dashRows) {
    const recs = (await client.query(
      `SELECT job_status, service_item_category, service_item, department_name,
              delay_duration, escalation_group, vip_code,
              created_datetime, acknowledged_datetime, completed_datetime
         FROM jo_records WHERE upload_job_id = $1`,
      [dash.upload_job_id],
    )).rows;
    if (recs.length === 0) { console.log(`  [SKIP] ${dash.hotel} — no jo_records`); continue; }

    const hourCompleted = {}, hourCompBkt = {}, hourAcknowledged = {}, hourRespBkt = {};
    const hourEsc = {}, hourEscBkt = {}, hourSlaTotal = {}, hourSlaComp = {};
    const hourSlaCatTotal = {}, hourSlaCatComp = {};
    const statusHourMap = {}, escGroupHourMap = {}, overdueCatHourMap = {}, catHourMap = {};
    const hourDelayed = {}, hourDelayedItem = {}, hourTimeout = {}, hourItemCount = {};
    const vipHourCount = {}, vipHourItemCount = {};

    for (const r of recs) {
      const statusRaw = (r.job_status ?? '').trim().toLowerCase();
      const status = r.job_status ?? 'Unknown';
      const category = r.service_item_category ?? 'Unknown';
      const item = r.service_item ?? 'Unknown';
      const completedFlag = statusRaw.includes('complete') || statusRaw.includes('close') || statusRaw.includes('done') || statusRaw.includes('finish');
      const timeoutFlag = statusRaw.includes('timeout');
      const delayMin = parseDurationMinutes(r.delay_duration);
      const escalatedFlag = !!(r.escalation_group && String(r.escalation_group).trim()) || (delayMin !== null && delayMin > 0);

      const createdAt = r.created_datetime ? new Date(r.created_datetime) : null;
      const ackAt = r.acknowledged_datetime ? new Date(r.acknowledged_datetime) : null;
      const completedAt = r.completed_datetime ? new Date(r.completed_datetime) : null;
      if (!createdAt || isNaN(createdAt.getTime())) continue;
      const h = localHour(createdAt, orgTz);

      inc(hourSlaTotal, h);
      inc2(hourItemCount, h, item);

      let resolutionMin = null;
      if (completedAt && !isNaN(completedAt.getTime()) && completedAt.getTime() >= createdAt.getTime()) {
        resolutionMin = (completedAt.getTime() - createdAt.getTime()) / 60_000;
      }

      if (completedFlag) {
        inc(hourCompleted, h);
        if (resolutionMin !== null) inc2(hourCompBkt, h, durBucket(resolutionMin));
        const isSlaCompliant = !(delayMin !== null && delayMin > 0);
        if (isSlaCompliant) inc(hourSlaComp, h);
        inc2(hourSlaCatTotal, h, category);
        if (isSlaCompliant) inc2(hourSlaCatComp, h, category);
      }

      if (ackAt && !isNaN(ackAt.getTime()) && ackAt.getTime() >= createdAt.getTime()) {
        const respMin = (ackAt.getTime() - createdAt.getTime()) / 60_000;
        inc(hourAcknowledged, h);
        inc2(hourRespBkt, h, durBucket(respMin));
      }

      if (escalatedFlag) {
        inc(hourEsc, h);
        if (delayMin !== null) inc2(hourEscBkt, h, durBucket(delayMin));
      }

      const statusKey = (status || 'Unknown').trim();
      if (!statusHourMap[statusKey]) statusHourMap[statusKey] = {};
      statusHourMap[statusKey][h] = (statusHourMap[statusKey][h] ?? 0) + 1;

      const escGroupKey = (r.escalation_group ?? '').toString().trim();
      if (escGroupKey) {
        if (!escGroupHourMap[escGroupKey]) escGroupHourMap[escGroupKey] = {};
        escGroupHourMap[escGroupKey][h] = (escGroupHourMap[escGroupKey][h] ?? 0) + 1;
      }

      if (!catHourMap[category]) catHourMap[category] = {};
      catHourMap[category][h] = (catHourMap[category][h] ?? 0) + 1;

      if (delayMin !== null && delayMin > 0) {
        if (!overdueCatHourMap[category]) overdueCatHourMap[category] = {};
        overdueCatHourMap[category][h] = (overdueCatHourMap[category][h] ?? 0) + 1;
        inc(hourDelayed, h);
        inc2(hourDelayedItem, h, item);
      }

      if (timeoutFlag) inc(hourTimeout, h);

      if (isVip(r.vip_code)) {
        inc(vipHourCount, h);
        inc2(vipHourItemCount, h, item);
      }
    }

    const summaryPatch = {
      jo_hour_comp_map: hourCompleted,
      jo_hour_comp_bkt_map: hourCompBkt,
      jo_hour_resp_bkt_map: hourRespBkt,
      jo_hour_esc_map: hourEsc,
      jo_hour_esc_bkt_map: hourEscBkt,
      jo_hour_sla_total_map: hourSlaTotal,
      jo_hour_sla_comp_map: hourSlaComp,
      jo_hour_sla_cat_total_map: hourSlaCatTotal,
      jo_hour_sla_cat_comp_map: hourSlaCatComp,
      jo_status_hour_map: statusHourMap,
      jo_escgroup_hour_map: escGroupHourMap,
      jo_overdue_cat_hour_map: overdueCatHourMap,
      jo_cat_hour_map: catHourMap,
      jo_hour_delayed_map: hourDelayed,
      jo_hour_delayed_item_map: hourDelayedItem,
      jo_hour_timeout_map: hourTimeout,
      jo_hour_item_map: hourItemCount,
      jo_vip_hour_map: vipHourCount,
      jo_vip_hour_item_map: vipHourItemCount,
    };

    await client.query(
      `UPDATE jo_dashboard_json
          SET generated_json = jsonb_set(generated_json, '{summary}',
                COALESCE(generated_json->'summary', '{}'::jsonb) || $1::jsonb),
              updated_at = NOW()
        WHERE id = $2`,
      [JSON.stringify(summaryPatch), dash.id],
    );
    console.log(`  [OK] ${dash.hotel} — ${recs.length} records refreshed`);
  }
}

// ── MO ────────────────────────────────────────────────────────────────────
async function refreshMo() {
  const dashRows = (await client.query(
    `SELECT id, upload_job_id, generated_json->'meta'->>'hotel_code' AS hotel FROM mo_dashboard_json`,
  )).rows;
  console.log(`\nMO: ${dashRows.length} dashboard row(s)`);

  for (const dash of dashRows) {
    const moCount = Number((await client.query(
      `SELECT COUNT(*)::int AS n FROM mo_records WHERE upload_job_id = $1 AND type = 'MO'`,
      [dash.upload_job_id],
    )).rows[0]?.n ?? 0);
    const typeFilter = moCount > 0 ? `AND type = 'MO'` : '';

    const rows = (await client.query(
      `SELECT EXTRACT(HOUR FROM created_datetime AT TIME ZONE $2)::int AS local_hour,
              resolution_minutes,
              COALESCE(NULLIF(defect, ''), NULLIF(asset, ''), NULLIF(job_order, ''), 'Unknown') AS item
         FROM mo_records
        WHERE upload_job_id = $1
          ${typeFilter}`,
      [dash.upload_job_id, orgTz],
    )).rows;

    if (rows.length === 0) { console.log(`  [SKIP] ${dash.hotel} — no mo_records`); continue; }

    const hourMap = {};
    const item24hHourMap = {};
    for (const { local_hour, resolution_minutes, item } of rows) {
      if (local_hour === null) continue;
      const h = String(local_hour);
      hourMap[h] = (hourMap[h] ?? 0) + 1;
      if (resolution_minutes !== null && Number(resolution_minutes) >= 1440) {
        if (!item24hHourMap[item]) item24hHourMap[item] = {};
        item24hHourMap[item][h] = (item24hHourMap[item][h] ?? 0) + 1;
      }
    }

    const hourP = JSON.stringify(hourMap);
    const item24P = JSON.stringify(item24hHourMap);
    await client.query(
      `UPDATE mo_dashboard_json
          SET generated_json = jsonb_set(jsonb_set(
                CASE
                  WHEN generated_json->'summary_by_type'->'MO' IS NOT NULL
                  THEN jsonb_set(jsonb_set(generated_json,
                         '{summary_by_type,MO,mo_hour_map}', $1::jsonb),
                         '{summary_by_type,MO,mo_item_24h_hour_map}', $2::jsonb)
                  ELSE generated_json
                END,
                '{summary,mo_hour_map}', $1::jsonb),
                '{summary,mo_item_24h_hour_map}', $2::jsonb),
              updated_at = NOW()
        WHERE id = $3`,
      [hourP, item24P, dash.id],
    );
    console.log(`  [OK] ${dash.hotel} — ${rows.length} records refreshed (${moCount > 0 ? 'MO' : 'all'} rows)`);
  }
}

// ── IM (hotel-level; corp is already live-recomputed at request time) ─────
async function refreshIm() {
  const dashRows = (await client.query(
    `SELECT id, upload_job_id, generated_json->'meta'->>'hotel_code' AS hotel
       FROM im_dashboard_json
      WHERE generated_json->'meta'->>'hotel_code' IS NOT NULL
        AND generated_json->'meta'->>'hotel_code' <> 'CORP'`,
  )).rows;
  console.log(`\nIM (hotel-level): ${dashRows.length} dashboard row(s)`);

  for (const dash of dashRows) {
    const recs = (await client.query(
      `SELECT department, incident_category, incident_item_name, vip_code,
              created_date, incident_datetime
         FROM im_records WHERE upload_job_id = $1`,
      [dash.upload_job_id],
    )).rows;
    if (recs.length === 0) { console.log(`  [SKIP] ${dash.hotel} — no im_records`); continue; }

    const hourMap = {}, hourCategoryMap = {}, hourDeptMap = {}, hourCategoryItemMap = {}, hourDeptItemMap = {}, vipHourMap = {};
    for (const r of recs) {
      const rawDate = r.incident_datetime ?? r.created_date;
      if (!rawDate) continue;
      const d = new Date(rawDate);
      if (isNaN(d.getTime())) continue;
      const h = String(localHour(d, orgTz));
      const cat = r.incident_category ?? 'Unknown';
      const dept = r.department ?? 'Unknown';
      const item = r.incident_item_name ?? 'Unknown';

      hourMap[h] = (hourMap[h] ?? 0) + 1;
      if (!hourCategoryMap[h]) hourCategoryMap[h] = {};
      hourCategoryMap[h][cat] = (hourCategoryMap[h][cat] ?? 0) + 1;
      if (!hourDeptMap[h]) hourDeptMap[h] = {};
      hourDeptMap[h][dept] = (hourDeptMap[h][dept] ?? 0) + 1;
      if (!hourCategoryItemMap[h]) hourCategoryItemMap[h] = {};
      if (!hourCategoryItemMap[h][cat]) hourCategoryItemMap[h][cat] = {};
      hourCategoryItemMap[h][cat][item] = (hourCategoryItemMap[h][cat][item] ?? 0) + 1;
      if (!hourDeptItemMap[h]) hourDeptItemMap[h] = {};
      if (!hourDeptItemMap[h][dept]) hourDeptItemMap[h][dept] = {};
      hourDeptItemMap[h][dept][item] = (hourDeptItemMap[h][dept][item] ?? 0) + 1;
      if (isVip(r.vip_code)) vipHourMap[h] = (vipHourMap[h] ?? 0) + 1;
    }

    const summaryPatch = {
      im_hour_map: hourMap,
      im_hour_category_map: hourCategoryMap,
      im_hour_dept_map: hourDeptMap,
      im_hour_category_item_map: hourCategoryItemMap,
      im_hour_dept_item_map: hourDeptItemMap,
      im_vip_hour_map: vipHourMap,
    };

    await client.query(
      `UPDATE im_dashboard_json
          SET generated_json = jsonb_set(generated_json, '{summary}',
                COALESCE(generated_json->'summary', '{}'::jsonb) || $1::jsonb),
              updated_at = NOW()
        WHERE id = $2`,
      [JSON.stringify(summaryPatch), dash.id],
    );
    console.log(`  [OK] ${dash.hotel} — ${recs.length} records refreshed`);
  }
}

await refreshJo();
await refreshMo();
await refreshIm();

console.log('\nDone.');
await client.end();
