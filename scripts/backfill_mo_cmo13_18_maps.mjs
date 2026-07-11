// Backfill the six new corp MO Long Charts maps into stored MO dashboard summaries:
//   mo_cat_defect_dur_map    (cmo-13: category → defect → resolution duration bucket → count)
//   mo_dur_defect_map        (cmo-14: resolution duration bucket → defect → count)
//   mo_delay_dur_defect_map  (cmo-15: delayed/escalated duration bucket → defect → count)
//   mo_hour_defect_map       (cmo-16: hour "0"-"23" → defect → count, all jobs)
//   mo_floor_defect_map      (cmo-17: floor → defect → count)
//   mo_type_dept_defect_map  (cmo-18: type (MO/PM) → created-by department → defect → count)
//
// Mirrors the TS accumulation added to the MO row loop in
// app/api/uploads/finalize/route.ts:
//   - resolution duration = completed_datetime - created_datetime (minutes)
//   - delayed/escalated duration = completed_datetime - deadline_datetime (minutes),
//     only counted when positive (completed past its deadline)
//   - duration buckets: < 1h, 1-2h, 2-4h, 4-8h, 8-24h, 24h+
//   - defect = defect ?? asset ?? job_order ?? 'Unknown'
//   - hour is computed in the org's configured timezone
//
// Note: unlike backfill_mo_item_maps.mjs, this script intentionally aggregates
// over ALL rows for the upload (not just type='MO') because cmo-18 needs both
// MO and PM rows to populate its Type level.
//
// Usage: node scripts/backfill_mo_cmo13_18_maps.mjs [DATABASE_URL]

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
       COALESCE(NULLIF(created_by_department, ''), 'Unknown') AS created_dept,
       COALESCE(NULLIF(floor, ''), 'Unknown') AS floor,
       COALESCE(NULLIF(type, ''), 'MO') AS type,
       COALESCE(created_hour, EXTRACT(HOUR FROM created_datetime AT TIME ZONE $2)::int) AS hour,
       resolution_minutes AS resolution_min,
       deadline_variance_minutes AS delay_min
     FROM mo_records
     WHERE upload_job_id = $1
       AND created_datetime IS NOT NULL`,
    [dash.upload_job_id, tz]
  )).rows;

  if (rows.length === 0) {
    console.log(`${dash.hotel} (${tz}): no rows — skipped`);
    continue;
  }

  const catDefectDur = {};
  const durDefect = {};
  const delayDurDefect = {};
  const hourDefect = {};
  const floorDefect = {};
  const typeDeptDefect = {};

  for (const r of rows) {
    const { defect, category, created_dept, floor, type, hour, resolution_min, delay_min } = r;

    if (resolution_min !== null && resolution_min !== undefined) {
      const bkt = durBucket(Number(resolution_min));
      if (!durDefect[bkt]) durDefect[bkt] = {};
      durDefect[bkt][defect] = (durDefect[bkt][defect] ?? 0) + 1;

      if (!catDefectDur[category]) catDefectDur[category] = {};
      if (!catDefectDur[category][defect]) catDefectDur[category][defect] = {};
      catDefectDur[category][defect][bkt] = (catDefectDur[category][defect][bkt] ?? 0) + 1;
    }

    if (delay_min !== null && delay_min !== undefined && Number(delay_min) > 0) {
      const bkt = durBucket(Number(delay_min));
      if (!delayDurDefect[bkt]) delayDurDefect[bkt] = {};
      delayDurDefect[bkt][defect] = (delayDurDefect[bkt][defect] ?? 0) + 1;
    }

    if (hour !== null && hour !== undefined) {
      const hKey = String(hour);
      if (!hourDefect[hKey]) hourDefect[hKey] = {};
      hourDefect[hKey][defect] = (hourDefect[hKey][defect] ?? 0) + 1;
    }

    if (!floorDefect[floor]) floorDefect[floor] = {};
    floorDefect[floor][defect] = (floorDefect[floor][defect] ?? 0) + 1;

    if (!typeDeptDefect[type]) typeDeptDefect[type] = {};
    if (!typeDeptDefect[type][created_dept]) typeDeptDefect[type][created_dept] = {};
    typeDeptDefect[type][created_dept][defect] = (typeDeptDefect[type][created_dept][defect] ?? 0) + 1;
  }

  const p1 = JSON.stringify(catDefectDur);
  const p2 = JSON.stringify(durDefect);
  const p3 = JSON.stringify(delayDurDefect);
  const p4 = JSON.stringify(hourDefect);
  const p5 = JSON.stringify(floorDefect);
  const p6 = JSON.stringify(typeDeptDefect);

  await client.query(
    `UPDATE mo_dashboard_json
        SET generated_json = jsonb_set(
              CASE
                WHEN generated_json->'summary_by_type'->'MO' IS NOT NULL
                THEN jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(generated_json,
                       '{summary_by_type,MO,mo_cat_defect_dur_map}', $1::jsonb),
                       '{summary_by_type,MO,mo_dur_defect_map}', $2::jsonb),
                       '{summary_by_type,MO,mo_delay_dur_defect_map}', $3::jsonb),
                       '{summary_by_type,MO,mo_hour_defect_map}', $4::jsonb),
                       '{summary_by_type,MO,mo_floor_defect_map}', $5::jsonb),
                       '{summary_by_type,MO,mo_type_dept_defect_map}', $6::jsonb)
                ELSE generated_json
              END,
              '{summary,mo_cat_defect_dur_map}', $1::jsonb),
            updated_at = NOW()
      WHERE id = $7`,
    [p1, p2, p3, p4, p5, p6, dash.id]
  );
  // The remaining {summary,...} keys are set in a second pass to keep the
  // single jsonb_set chain above readable.
  await client.query(
    `UPDATE mo_dashboard_json
        SET generated_json = jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(
              generated_json,
              '{summary,mo_dur_defect_map}', $1::jsonb),
              '{summary,mo_delay_dur_defect_map}', $2::jsonb),
              '{summary,mo_hour_defect_map}', $3::jsonb),
              '{summary,mo_floor_defect_map}', $4::jsonb),
              '{summary,mo_type_dept_defect_map}', $5::jsonb),
            updated_at = NOW()
      WHERE id = $6`,
    [p2, p3, p4, p5, p6, dash.id]
  );

  console.log(`${dash.hotel} (${tz}): ${rows.length} rows → cat_defect_dur=${Object.keys(catDefectDur).length}, dur_defect=${Object.keys(durDefect).length}, delay_dur_defect=${Object.keys(delayDurDefect).length}, hour_defect=${Object.keys(hourDefect).length}, floor_defect=${Object.keys(floorDefect).length}, type_dept_defect=${Object.keys(typeDeptDefect).length} backfilled`);
}

await client.end();
