// Backfill jo_hour_delayed_item_map (hour → service_item → count for DELAYED jobs)
// into stored jo_dashboard_json summaries, aggregated from jo_records.
// Mirrors the jo-01 accumulator in app/api/uploads/finalize/route.ts:
// delayed = delay_duration parseable and > 0 (non-blank, not all zeros like "00:00").
// Hours are computed in the organisation's configured timezone (organizations.timezone).
//
// Usage: node scripts/backfill_jo_hour_delayed_item_map.mjs [DATABASE_URL]
//        (defaults to local fcs1_local)

import pg from 'pg';
const { Client } = pg;

const connectionString = process.argv[2] ?? 'postgresql://postgres:Qazz%40%402010@localhost:5432/fcs1_local';

const client = new Client({ connectionString });
await client.connect();

const dashRows = (await client.query(
  `SELECT jd.id, jd.upload_job_id,
          jd.generated_json->'meta'->>'hotel_code' AS hotel,
          (jd.generated_json->'summary'->'jo_hour_delayed_item_map') IS NOT NULL AS has_map,
          COALESCE(o.timezone, 'UTC') AS org_timezone
     FROM jo_dashboard_json jd
     JOIN upload_jobs uj ON uj.id = jd.upload_job_id
     JOIN organizations o ON o.id = uj.organization_id`
)).rows;

for (const dash of dashRows) {
  const tz = dash.org_timezone;

  const agg = (await client.query(
    `SELECT EXTRACT(HOUR FROM created_datetime AT TIME ZONE $2)::int AS hour,
            COALESCE(NULLIF(TRIM(service_item), ''), 'Unknown') AS item,
            COUNT(*)::int AS cnt
       FROM jo_records
      WHERE upload_job_id = $1
        AND created_datetime IS NOT NULL
        AND delay_duration IS NOT NULL
        AND TRIM(delay_duration) <> ''
        AND TRIM(delay_duration) !~ '^[0:]+$'
      GROUP BY 1, 2`,
    [dash.upload_job_id, tz]
  )).rows;

  if (agg.length === 0) {
    console.log(`${dash.hotel} (${tz}): no delayed records — skipped`);
    continue;
  }

  const map = {};
  let total = 0;
  for (const { hour, item, cnt } of agg) {
    const h = String(hour);
    if (!map[h]) map[h] = {};
    map[h][item] = (map[h][item] ?? 0) + cnt;
    total += cnt;
  }

  await client.query(
    `UPDATE jo_dashboard_json
        SET generated_json = jsonb_set(generated_json, '{summary,jo_hour_delayed_item_map}', $1::jsonb),
            updated_at = NOW()
      WHERE id = $2`,
    [JSON.stringify(map), dash.id]
  );
  console.log(`${dash.hotel} (${tz}): ${total} delayed records → ${Object.keys(map).length} hours backfilled${dash.has_map ? ' (overwrote)' : ''}`);
}

await client.end();
