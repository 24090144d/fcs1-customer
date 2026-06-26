// Backfill im_vip_hour_map (hour → VIP incident count) into stored im_dashboard_json summaries.
// Mirrors the im-04 accumulator added to app/api/uploads/finalize/route.ts.
// Hours are computed in the organisation's configured timezone (organizations.timezone).
//
// Usage: node scripts/backfill_im_vip_hour_map.mjs [DATABASE_URL]
//        (defaults to local fcs1_local)

import pg from 'pg';
const { Client } = pg;

const connectionString = process.argv[2] ?? 'postgresql://postgres:Qazz%40%402010@localhost:5432/fcs1_local';

const client = new Client({ connectionString });
await client.connect();

const dashRows = (await client.query(
  `SELECT d.id, d.upload_job_id,
          d.generated_json->'meta'->>'hotel_code' AS hotel,
          COALESCE(o.timezone, 'UTC') AS org_timezone
     FROM im_dashboard_json d
     JOIN upload_jobs uj ON uj.id = d.upload_job_id
     JOIN organizations o ON o.id = uj.organization_id`,
)).rows;

console.log(`Found ${dashRows.length} IM dashboard row(s).`);

for (const dash of dashRows) {
  const tz = dash.org_timezone;

  // VIP rule: vip_code is non-null, non-empty, not just '-'
  const agg = (await client.query(
    `SELECT EXTRACT(HOUR FROM incident_datetime AT TIME ZONE $2)::int AS hour,
            COUNT(*)::int AS cnt
       FROM im_records
      WHERE upload_job_id = $1
        AND incident_datetime IS NOT NULL
        AND vip_code IS NOT NULL
        AND TRIM(vip_code) <> ''
        AND TRIM(vip_code) <> '-'
      GROUP BY 1`,
    [dash.upload_job_id, tz],
  )).rows;

  const map = {};
  let total = 0;
  for (const { hour, cnt } of agg) {
    map[String(hour)] = cnt;
    total += cnt;
  }

  await client.query(
    `UPDATE im_dashboard_json
        SET generated_json = jsonb_set(generated_json, '{summary,im_vip_hour_map}', $1::jsonb),
            updated_at = NOW()
      WHERE id = $2`,
    [JSON.stringify(map), dash.id],
  );
  console.log(`${dash.hotel} (${tz}): ${total} VIP incidents → ${Object.keys(map).length} hours backfilled`);
}

await client.end();
console.log('\nDone.');
