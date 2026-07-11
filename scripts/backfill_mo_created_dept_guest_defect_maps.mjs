// Backfill mo_created_dept_defect_map (created-by department → defect → count)
// and mo_guest_defect_map ('Guest Related'|'Non Guest Related' → defect → count)
// into stored MO dashboard summaries.
//
// Mirrors the TS accumulation added to the MO row loop in
// app/api/uploads/finalize/route.ts: defect = defect ?? asset ?? job_order ?? 'Unknown';
// created department defaults to 'Unknown' when blank/null; guest_related truthy-like
// values ('true','yes','y','1','pass','passed', case-insensitive) count as Guest Related.
//
// Uses type = 'MO' rows when any exist for the upload, else all rows (matches
// backfill_mo_item_maps.mjs's convention).
//
// Usage: node scripts/backfill_mo_created_dept_guest_defect_maps.mjs [DATABASE_URL]

import pg from 'pg';
const { Client } = pg;

const connectionString = process.argv[2] ?? 'postgresql://postgres:Qazz%40%402010@localhost:5432/fcs1_local';

const client = new Client({ connectionString });
await client.connect();

const TRUTHY = new Set(['true', 'yes', 'y', '1', 'pass', 'passed']);

const dashRows = (await client.query(
  `SELECT id, upload_job_id, generated_json->'meta'->>'hotel_code' AS hotel
     FROM mo_dashboard_json`
)).rows;

for (const dash of dashRows) {
  const moCount = Number((await client.query(
    `SELECT COUNT(*)::int AS n FROM mo_records WHERE upload_job_id = $1 AND type = 'MO'`,
    [dash.upload_job_id]
  )).rows[0]?.n ?? 0);
  const typeFilter = moCount > 0 ? `AND type = 'MO'` : '';

  const rows = (await client.query(
    `SELECT
       COALESCE(NULLIF(defect, ''), NULLIF(asset, ''), NULLIF(job_order, ''), 'Unknown') AS defect,
       COALESCE(NULLIF(created_by_department, ''), 'Unknown') AS created_dept,
       guest_related
     FROM mo_records
     WHERE upload_job_id = $1
       ${typeFilter}`,
    [dash.upload_job_id]
  )).rows;

  if (rows.length === 0) {
    console.log(`${dash.hotel}: no rows — skipped`);
    continue;
  }

  const deptDefectMap = {};
  const guestDefectMap = {};
  for (const { defect, created_dept, guest_related } of rows) {
    if (!deptDefectMap[created_dept]) deptDefectMap[created_dept] = {};
    deptDefectMap[created_dept][defect] = (deptDefectMap[created_dept][defect] ?? 0) + 1;

    const guestKey = TRUTHY.has(String(guest_related ?? '').trim().toLowerCase()) ? 'Guest Related' : 'Non Guest Related';
    if (!guestDefectMap[guestKey]) guestDefectMap[guestKey] = {};
    guestDefectMap[guestKey][defect] = (guestDefectMap[guestKey][defect] ?? 0) + 1;
  }

  const deptP = JSON.stringify(deptDefectMap);
  const guestP = JSON.stringify(guestDefectMap);
  await client.query(
    `UPDATE mo_dashboard_json
        SET generated_json = jsonb_set(jsonb_set(
              CASE
                WHEN generated_json->'summary_by_type'->'MO' IS NOT NULL
                THEN jsonb_set(jsonb_set(generated_json,
                       '{summary_by_type,MO,mo_created_dept_defect_map}', $1::jsonb),
                       '{summary_by_type,MO,mo_guest_defect_map}', $2::jsonb)
                ELSE generated_json
              END,
              '{summary,mo_created_dept_defect_map}', $1::jsonb),
              '{summary,mo_guest_defect_map}', $2::jsonb),
            updated_at = NOW()
      WHERE id = $3`,
    [deptP, guestP, dash.id]
  );
  console.log(`${dash.hotel}: ${rows.length} rows → ${Object.keys(deptDefectMap).length} departments, ${Object.keys(guestDefectMap).length} guest buckets backfilled (${moCount > 0 ? 'MO' : 'all'} rows)`);
}

await client.end();
