// Backfill im_hour_map (hour → total incident count) and im_vip_hour_map (hour → VIP count)
// into stored im_dashboard_json summaries.
// Mirrors the im-04 accumulators in app/api/uploads/finalize/route.ts.
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

  // Total hourly distribution (im_hour_map)
  const totalAgg = (await client.query(
    `SELECT EXTRACT(HOUR FROM incident_datetime AT TIME ZONE $2)::int AS hour,
            COUNT(*)::int AS cnt
       FROM im_records
      WHERE upload_job_id = $1
        AND incident_datetime IS NOT NULL
      GROUP BY 1`,
    [dash.upload_job_id, tz],
  )).rows;

  const hourMap = {};
  let totalHours = 0;
  for (const { hour, cnt } of totalAgg) {
    hourMap[String(hour)] = cnt;
    totalHours += cnt;
  }

  // VIP hourly distribution (im_vip_hour_map)
  // VIP rule: vip_code is non-null, non-empty, not just '-'
  const vipAgg = (await client.query(
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

  const vipMap = {};
  let totalVip = 0;
  for (const { hour, cnt } of vipAgg) {
    vipMap[String(hour)] = cnt;
    totalVip += cnt;
  }

  // Write both maps in a single update
  await client.query(
    `UPDATE im_dashboard_json
        SET generated_json = jsonb_set(
              jsonb_set(generated_json, '{summary,im_hour_map}', $1::jsonb),
              '{summary,im_vip_hour_map}', $2::jsonb
            ),
            updated_at = NOW()
      WHERE id = $3`,
    [JSON.stringify(hourMap), JSON.stringify(vipMap), dash.id],
  );
  console.log(`${dash.hotel} (${tz}): ${totalHours} total + ${totalVip} VIP incidents backfilled`);
}

await client.end();
console.log('\nDone.');
