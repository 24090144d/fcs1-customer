// Backfill jo_item_date_map (service item → YYYY-MM-DD → count) into stored
// jo_dashboard_json summaries, aggregated from jo_records.
// Mirrors accumulateJoKpis() in app/api/uploads/finalize/route.ts (v1.0.62+),
// so legacy uploads gain jo-11 date filtering without a re-upload.
//
// Usage: node scripts/backfill_jo_item_date_map.mjs [DATABASE_URL]
//        (defaults to local fcs1_local)

import pg from 'pg';
const { Client } = pg;

const connectionString = process.argv[2] ?? 'postgresql://postgres:Qazz%40%402010@localhost:5432/fcs1_local';

const client = new Client({ connectionString });
await client.connect();

const dashRows = (await client.query(
  `SELECT id, upload_job_id, generated_json->'meta'->>'hotel_code' AS hotel,
          (generated_json->'summary'->'jo_item_date_map') IS NOT NULL AS has_idm
     FROM jo_dashboard_json`
)).rows;

for (const dash of dashRows) {
  const agg = (await client.query(
    `SELECT COALESCE(NULLIF(TRIM(service_item), ''), 'Unknown') AS item,
            to_char(created_datetime AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS date_key,
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

  const itemDateMap = {};
  let total = 0;
  for (const { item, date_key, cnt } of agg) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date_key)) continue;
    if (!itemDateMap[item]) itemDateMap[item] = {};
    itemDateMap[item][date_key] = (itemDateMap[item][date_key] ?? 0) + cnt;
    total += cnt;
  }

  await client.query(
    `UPDATE jo_dashboard_json
        SET generated_json = jsonb_set(generated_json, '{summary,jo_item_date_map}', $1::jsonb),
            updated_at = NOW()
      WHERE id = $2`,
    [JSON.stringify(itemDateMap), dash.id]
  );
  console.log(`${dash.hotel}: ${total} records → ${Object.keys(itemDateMap).length} items backfilled${dash.has_idm ? ' (overwrote existing)' : ''}`);
}

await client.end();
