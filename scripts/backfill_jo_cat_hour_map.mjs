// Backfill jo_cat_hour_map (service_item_category → hour → count for ALL jobs)
// into stored jo_dashboard_json summaries, aggregated from jo_records.
// Mirrors the jo-02 accumulator in app/api/uploads/finalize/route.ts.
//
// Usage: node scripts/backfill_jo_cat_hour_map.mjs [DATABASE_URL]
//        (defaults to local fcs1_local)

import pg from 'pg';
const { Client } = pg;

const connectionString = process.argv[2] ?? 'postgresql://postgres:Qazz%40%402010@localhost:5432/fcs1_local';

const client = new Client({ connectionString });
await client.connect();

const dashRows = (await client.query(
  `SELECT id, upload_job_id, generated_json->'meta'->>'hotel_code' AS hotel,
          (generated_json->'summary'->'jo_cat_hour_map') IS NOT NULL AS has_map
     FROM jo_dashboard_json`
)).rows;

for (const dash of dashRows) {
  const agg = (await client.query(
    `SELECT COALESCE(NULLIF(TRIM(service_item_category), ''), 'Unknown') AS category,
            EXTRACT(HOUR FROM created_datetime AT TIME ZONE 'UTC')::int AS hour,
            COUNT(*)::int AS cnt
       FROM jo_records
      WHERE upload_job_id = $1 AND created_datetime IS NOT NULL
      GROUP BY 1, 2`,
    [dash.upload_job_id]
  )).rows;

  if (agg.length === 0) {
    console.log(`${dash.hotel}: no records — skipped`);
    continue;
  }

  const map = {};
  let total = 0;
  for (const { category, hour, cnt } of agg) {
    if (!map[category]) map[category] = {};
    map[category][String(hour)] = (map[category][String(hour)] ?? 0) + cnt;
    total += cnt;
  }

  await client.query(
    `UPDATE jo_dashboard_json
        SET generated_json = jsonb_set(generated_json, '{summary,jo_cat_hour_map}', $1::jsonb),
            updated_at = NOW()
      WHERE id = $2`,
    [JSON.stringify(map), dash.id]
  );
  console.log(`${dash.hotel}: ${total} records → ${Object.keys(map).length} categories backfilled${dash.has_map ? ' (overwrote existing)' : ''}`);
}

await client.end();
