// Backfill the new corp MO chart-batch maps into stored MO dashboard summaries:
//   mo_dim_defect_stats_map        (cmo-14..22: dimension -> dimension value -> defect -> stats)
//   mo_completedby_defect_stats_map (cmo-13: completed-by person -> defect -> stats)
//
// Mirrors the TS accumulation added to the MO row loop in
// app/api/uploads/finalize/route.ts:
//   - "Duration = 0 when not yet Completed" — completed_hours = completed_datetime -
//     created_datetime in hours when completed_datetime exists, else 0 (an uncompleted
//     job isn't Completed/Delayed, so it still counts toward Total Order but contributes
//     0 hours rather than being excluded)
//   - delayed = is_overdue (escalated, or past deadline with no/late completion)
//   - department = created_by_department (created department, not assigned)
//   - duration buckets: < 1h, 1-2h, 2-4h, 4-8h, 8-24h, 24h+ (based on completed_hours)
//   - defect = defect ?? asset ?? job_order ?? 'Unknown'
//   - hour is computed in the org's configured timezone
//
// Usage: node scripts/backfill_mo_cmo13_22_maps.mjs [DATABASE_URL]

import pg from 'pg';
const { Client } = pg;

const connectionString = process.argv[2] ?? 'postgresql://postgres:Qazz%40%402010@localhost:5432/fcs1_local';

const client = new Client({ connectionString });
await client.connect();

function durBucket(minutes) {
  if (minutes < 60) return '< 1h';
  if (minutes < 120) return '1-2h';
  if (minutes < 240) return '2-4h';
  if (minutes < 480) return '4-8h';
  if (minutes < 1440) return '8-24h';
  return '24h+';
}

function r2(n) { return Math.round(n * 100) / 100; }
function r1(n) { return Math.round(n * 10) / 10; }

function bump(map, dim, dimVal, defect, hours, delayed) {
  if (!map[dim]) map[dim] = {};
  if (!map[dim][dimVal]) map[dim][dimVal] = {};
  if (!map[dim][dimVal][defect]) map[dim][dimVal][defect] = { count: 0, durSum: 0, delayed: 0 };
  const a = map[dim][dimVal][defect];
  a.count += 1;
  a.durSum += hours;
  if (delayed) a.delayed += 1;
}

function toStatsMap(dm) {
  return Object.fromEntries(Object.entries(dm).map(([defect, a]) => [defect, {
    count: a.count,
    avgDurationHours: a.count > 0 ? r2(a.durSum / a.count) : 0,
    delayRate: a.count > 0 ? r1((a.delayed / a.count) * 100) : 0,
  }]));
}

const dashRows = (await client.query(
  `SELECT jd.id, jd.upload_job_id,
          jd.generated_json->'meta'->>'hotel_code' AS hotel,
          COALESCE(o.timezone, 'UTC') AS org_timezone
     FROM mo_dashboard_json jd
     JOIN upload_jobs uj ON uj.id = jd.upload_job_id
     JOIN organizations o ON o.id = uj.organization_id`
)).rows;

for (const dash of dashRows) {
  const tz = dash.org_timezone;

  const rows = (await client.query(
    `SELECT
       COALESCE(NULLIF(defect, ''), NULLIF(asset, ''), NULLIF(job_order, ''), 'Unknown') AS defect,
       COALESCE(NULLIF(category, ''), 'Uncategorized') AS category,
       COALESCE(NULLIF(created_by_department, ''), 'Unknown') AS department,
       COALESCE(NULLIF(guest_related, ''), 'N') AS guest_related,
       COALESCE(NULLIF(type, ''), 'MO') AS type,
       COALESCE(NULLIF(job_status, ''), 'Unknown') AS job_status,
       COALESCE(NULLIF(completed_by, ''), 'Unknown') AS completed_by,
       COALESCE(escalation_level_num, 0) AS esc_level,
       is_overdue,
       COALESCE(created_hour, EXTRACT(HOUR FROM created_datetime AT TIME ZONE $2)::int) AS hour,
       created_datetime,
       completed_datetime
     FROM mo_records
     WHERE upload_job_id = $1
       AND created_datetime IS NOT NULL`,
    [dash.upload_job_id, tz]
  )).rows;

  if (rows.length === 0) {
    console.log(`${dash.hotel} (${tz}): no rows — skipped`);
    continue;
  }

  const dimDefectAcc = {};
  const completedByDefectAcc = {};

  for (const r of rows) {
    const hours = r.completed_datetime
      ? Math.max(0, (new Date(r.completed_datetime).getTime() - new Date(r.created_datetime).getTime()) / 3600000)
      : 0;
    const durBktKey = durBucket(hours * 60);
    const guestKey = /^(y|yes|true|1)$/i.test(String(r.guest_related)) ? 'Guest Related' : 'Non Guest Related';
    const otKey = r.is_overdue ? 'Delayed' : 'On Time';
    const escKey = `E${r.esc_level ?? 0}`;
    const delayed = !!r.is_overdue;

    bump(dimDefectAcc, 'category', r.category, r.defect, hours, delayed);
    bump(dimDefectAcc, 'department', r.department, r.defect, hours, delayed);
    bump(dimDefectAcc, 'guest', guestKey, r.defect, hours, delayed);
    bump(dimDefectAcc, 'ontime', otKey, r.defect, hours, delayed);
    bump(dimDefectAcc, 'type', r.type, r.defect, hours, delayed);
    bump(dimDefectAcc, 'durbkt', durBktKey, r.defect, hours, delayed);
    if (r.hour !== null && r.hour !== undefined) {
      bump(dimDefectAcc, 'hour', String(r.hour).padStart(2, '0'), r.defect, hours, delayed);
    }
    bump(dimDefectAcc, 'esclevel', escKey, r.defect, hours, delayed);
    bump(dimDefectAcc, 'status', r.job_status, r.defect, hours, delayed);

    if (!completedByDefectAcc[r.completed_by]) completedByDefectAcc[r.completed_by] = {};
    if (!completedByDefectAcc[r.completed_by][r.defect]) completedByDefectAcc[r.completed_by][r.defect] = { count: 0, durSum: 0, delayed: 0 };
    const cbAcc = completedByDefectAcc[r.completed_by][r.defect];
    cbAcc.count += 1;
    cbAcc.durSum += hours;
    if (delayed) cbAcc.delayed += 1;
  }

  const dimDefectStatsMap = Object.fromEntries(
    Object.entries(dimDefectAcc).map(([dim, dimMap]) => [
      dim,
      Object.fromEntries(Object.entries(dimMap).map(([dimVal, dm]) => [dimVal, toStatsMap(dm)])),
    ]),
  );
  const completedByDefectStatsMap = Object.fromEntries(
    Object.entries(completedByDefectAcc).map(([person, dm]) => [person, toStatsMap(dm)]),
  );

  const p1 = JSON.stringify(dimDefectStatsMap);
  const p2 = JSON.stringify(completedByDefectStatsMap);

  await client.query(
    `UPDATE mo_dashboard_json
        SET generated_json = jsonb_set(
              CASE
                WHEN generated_json->'summary_by_type'->'MO' IS NOT NULL
                THEN jsonb_set(jsonb_set(generated_json,
                       '{summary_by_type,MO,mo_dim_defect_stats_map}', $1::jsonb),
                       '{summary_by_type,MO,mo_completedby_defect_stats_map}', $2::jsonb)
                ELSE generated_json
              END,
              '{summary,mo_dim_defect_stats_map}', $1::jsonb),
            updated_at = NOW()
      WHERE id = $3`,
    [p1, p2, dash.id]
  );
  await client.query(
    `UPDATE mo_dashboard_json
        SET generated_json = jsonb_set(generated_json, '{summary,mo_completedby_defect_stats_map}', $1::jsonb),
            updated_at = NOW()
      WHERE id = $2`,
    [p2, dash.id]
  );

  console.log(`${dash.hotel} (${tz}): ${rows.length} rows -> dims=${Object.keys(dimDefectStatsMap).length}, completed_by=${Object.keys(completedByDefectStatsMap).length} backfilled`);
}

await client.end();
