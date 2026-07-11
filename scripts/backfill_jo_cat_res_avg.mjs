// Backfill jo_cat_res_avg (service_item_category → average resolution minutes)
// into stored jo_dashboard_json summaries, aggregated from jo_records.
// Mirrors accumulateJoKpis()'s catItemResolution accumulation in
// app/api/uploads/finalize/route.ts: resolution = completed_datetime -
// created_datetime (minutes), only counted when both are present and
// completed >= created. Powers jo-04's new dual-axis chart: Item Category
// (bar, job count) vs Average Service Duration (line, avg resolution min).
//
// Usage: node scripts/backfill_jo_cat_res_avg.mjs [DATABASE_URL]
//        (defaults to local fcs1_local)

import pg from 'pg';
const { Client } = pg;

const connectionString = process.argv[2] ?? 'postgresql://postgres:Qazz%40%402010@localhost:5432/fcs1_local';

const client = new Client({ connectionString });
await client.connect();

const dashRows = (await client.query(
  `SELECT jd.id, jd.upload_job_id, jd.generated_json->'meta'->>'hotel_code' AS hotel
     FROM jo_dashboard_json jd`
)).rows;

for (const dash of dashRows) {
  const agg = (await client.query(
    `SELECT COALESCE(NULLIF(TRIM(service_item_category), ''), 'Unknown') AS category,
            AVG(EXTRACT(EPOCH FROM (completed_datetime - created_datetime)) / 60)::numeric(10,2) AS avg_min,
            COUNT(*)::int AS cnt
       FROM jo_records
      WHERE upload_job_id = $1
        AND created_datetime IS NOT NULL
        AND completed_datetime IS NOT NULL
        AND completed_datetime >= created_datetime
      GROUP BY 1`,
    [dash.upload_job_id]
  )).rows;

  if (agg.length === 0) {
    console.log(`${dash.hotel}: no completed records with resolution time — skipped`);
    continue;
  }

  const map = {};
  let total = 0;
  for (const { category, avg_min, cnt } of agg) {
    map[category] = Number(avg_min);
    total += cnt;
  }

  await client.query(
    `UPDATE jo_dashboard_json
        SET generated_json = jsonb_set(generated_json, '{summary,jo_cat_res_avg}', $1::jsonb),
            updated_at = NOW()
      WHERE id = $2`,
    [JSON.stringify(map), dash.id]
  );
  console.log(`${dash.hotel}: ${total} records → ${Object.keys(map).length} categories backfilled`);
}

await client.end();
