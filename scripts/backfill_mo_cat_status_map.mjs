// Backfill cat_status_map (category → job_status → count) into stored MO dashboard
// summaries, computed from mo_records. Mirrors buildMoJson's accumulator scope:
// uses type = 'MO' rows when any exist for the upload, else all rows for the upload.
//
// Usage: node scripts/backfill_mo_cat_status_map.mjs [DATABASE_URL]

import pg from 'pg';
const { Client } = pg;

const connectionString = process.argv[2] ?? 'postgresql://postgres:Qazz%40%402010@localhost:5432/fcs1_local';

const client = new Client({ connectionString });
await client.connect();

const dashRows = (await client.query(
  `SELECT id, upload_job_id, generated_json->'meta'->>'hotel_code' AS hotel
     FROM mo_dashboard_json`
)).rows;

for (const dash of dashRows) {
  // Match buildMoJson: prefer MO-typed rows; fall back to all rows if none.
  const moCount = Number((await client.query(
    `SELECT COUNT(*)::int AS n FROM mo_records WHERE upload_job_id = $1 AND type = 'MO'`,
    [dash.upload_job_id]
  )).rows[0]?.n ?? 0);
  const typeFilter = moCount > 0 ? `AND type = 'MO'` : '';

  // category → incident_category (default 'Uncategorized'); job_status →
  // normalized incident_status, replicating mapMoStatusToIncidentStatus() so the
  // drilldown taxonomy matches the summary status_map (Pending/Cancelled/Completed).
  const agg = (await client.query(
    `SELECT COALESCE(NULLIF(TRIM(category), ''), 'Uncategorized') AS cat,
            CASE
              WHEN COALESCE(TRIM(job_status), '') = '' THEN 'Pending'
              WHEN LOWER(job_status) LIKE '%cancel%' THEN 'Cancelled'
              WHEN LOWER(job_status) LIKE '%complete%' OR LOWER(job_status) LIKE '%close%'
                OR LOWER(job_status) LIKE '%done%' OR LOWER(job_status) LIKE '%finish%' THEN 'Completed'
              ELSE 'Pending'
            END AS status,
            COUNT(*)::int AS cnt
       FROM mo_records
      WHERE upload_job_id = $1
        ${typeFilter}
      GROUP BY 1, 2`,
    [dash.upload_job_id]
  )).rows;

  if (agg.length === 0) {
    console.log(`${dash.hotel}: no category/status rows — skipped`);
    continue;
  }

  const catStatusMap = {};
  for (const { cat, status, cnt } of agg) {
    if (!catStatusMap[cat]) catStatusMap[cat] = {};
    catStatusMap[cat][status] = cnt;
  }

  await client.query(
    `UPDATE mo_dashboard_json
        SET generated_json = jsonb_set(generated_json, '{summary,cat_status_map}', $1::jsonb),
            updated_at = NOW()
      WHERE id = $2`,
    [JSON.stringify(catStatusMap), dash.id]
  );
  console.log(`${dash.hotel}: ${Object.keys(catStatusMap).length} categories backfilled (${moCount > 0 ? 'MO' : 'all'} rows)`);
}

await client.end();
