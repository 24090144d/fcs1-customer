// Backfill jo_item_dur_bkt_map (service item → completion-duration bucket → count)
// into stored jo_dashboard_json summaries, aggregated from jo_records.
// Mirrors the jo-03 accumulator in app/api/uploads/finalize/route.ts:
//   completedFlag = job_status includes complete/close/done/finish
//   resolutionMin = completed_datetime - created_datetime (minutes), completed >= created
//   durBucket     = < 15 / 15–30 / 30–60 / 1–2h / 2–4h / 4–8h / 8+h
// so legacy uploads gain the jo-03 drilldown without a re-upload.
//
// Usage: node scripts/backfill_jo_item_dur_bkt_map.mjs [DATABASE_URL]
//        (defaults to local fcs1_local)

import pg from 'pg';
const { Client } = pg;

const connectionString = process.argv[2] ?? 'postgresql://postgres:Qazz%40%402010@localhost:5432/fcs1_local';

const client = new Client({ connectionString });
await client.connect();

const dashRows = (await client.query(
  `SELECT id, upload_job_id, generated_json->'meta'->>'hotel_code' AS hotel,
          (generated_json->'summary'->'jo_item_dur_bkt_map') IS NOT NULL AS has_map
     FROM jo_dashboard_json`
)).rows;

for (const dash of dashRows) {
  const agg = (await client.query(
    `WITH d AS (
       SELECT COALESCE(NULLIF(TRIM(service_item), ''), 'Unknown') AS item,
              EXTRACT(EPOCH FROM (completed_datetime - created_datetime)) / 60.0 AS mins
         FROM jo_records
        WHERE upload_job_id = $1
          AND created_datetime IS NOT NULL
          AND completed_datetime IS NOT NULL
          AND completed_datetime >= created_datetime
          AND (
            LOWER(job_status) LIKE '%complete%' OR LOWER(job_status) LIKE '%close%'
            OR LOWER(job_status) LIKE '%done%'  OR LOWER(job_status) LIKE '%finish%'
          )
     )
     SELECT item,
            CASE
              WHEN mins < 15  THEN '< 15 min'
              WHEN mins < 30  THEN '15–30 min'
              WHEN mins < 60  THEN '30–60 min'
              WHEN mins < 120 THEN '1–2 h'
              WHEN mins < 240 THEN '2–4 h'
              WHEN mins < 480 THEN '4–8 h'
              ELSE '8+ h'
            END AS bucket,
            COUNT(*)::int AS cnt
       FROM d
      GROUP BY 1, 2`,
    [dash.upload_job_id]
  )).rows;

  if (agg.length === 0) {
    console.log(`${dash.hotel}: no completed records — skipped`);
    continue;
  }

  const map = {};
  let total = 0;
  for (const { item, bucket, cnt } of agg) {
    if (!map[item]) map[item] = {};
    map[item][bucket] = (map[item][bucket] ?? 0) + cnt;
    total += cnt;
  }

  await client.query(
    `UPDATE jo_dashboard_json
        SET generated_json = jsonb_set(generated_json, '{summary,jo_item_dur_bkt_map}', $1::jsonb),
            updated_at = NOW()
      WHERE id = $2`,
    [JSON.stringify(map), dash.id]
  );
  console.log(`${dash.hotel}: ${total} completed → ${Object.keys(map).length} items backfilled${dash.has_map ? ' (overwrote existing)' : ''}`);
}

await client.end();
