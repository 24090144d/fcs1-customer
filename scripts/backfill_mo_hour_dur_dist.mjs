// Backfill mo_duration_dist_map (bucket → count) and mo_hour_map (hour → count)
// into stored MO dashboard summaries, computed from mo_records.
//
// Uses type = 'MO' rows when any exist for the upload, else all rows.
//
// Usage: node scripts/backfill_mo_hour_dur_dist.mjs [DATABASE_URL]

import pg from 'pg';
const { Client } = pg;

const connectionString = process.argv[2] ?? 'postgresql://postgres:Qazz%40%402010@localhost:5432/fcs1_local';

const client = new Client({ connectionString });
await client.connect();

// Read org timezone for local-hour computation
const orgTz = (await client.query(
  `SELECT COALESCE(timezone, 'UTC') AS tz FROM organizations ORDER BY created_at LIMIT 1`
)).rows[0]?.tz ?? 'UTC';
console.log(`Using timezone: ${orgTz}`);

const dashRows = (await client.query(
  `SELECT id, upload_job_id, generated_json->'meta'->>'hotel_code' AS hotel
     FROM mo_dashboard_json`
)).rows;

function durBucket(minutes) {
  if (minutes < 60)   return '< 1h';
  if (minutes < 120)  return '1-2h';
  if (minutes < 240)  return '2-4h';
  if (minutes < 480)  return '4-8h';
  if (minutes < 1440) return '8-24h';
  return '24h+';
}

for (const dash of dashRows) {
  const moCount = Number((await client.query(
    `SELECT COUNT(*)::int AS n FROM mo_records WHERE upload_job_id = $1 AND type = 'MO'`,
    [dash.upload_job_id]
  )).rows[0]?.n ?? 0);
  const typeFilter = moCount > 0 ? `AND type = 'MO'` : '';

  const rows = (await client.query(
    `SELECT EXTRACT(HOUR FROM created_datetime AT TIME ZONE $2)::int AS local_hour,
            resolution_minutes
       FROM mo_records
      WHERE upload_job_id = $1
        ${typeFilter}`,
    [dash.upload_job_id, orgTz]
  )).rows;

  if (rows.length === 0) {
    console.log(`${dash.hotel}: no rows — skipped`);
    continue;
  }

  const hourMap = {};
  const durDistMap = {};

  for (const { local_hour, resolution_minutes } of rows) {
    if (local_hour !== null) {
      const h = String(local_hour);
      hourMap[h] = (hourMap[h] ?? 0) + 1;
    }
    if (resolution_minutes !== null) {
      const bucket = durBucket(Number(resolution_minutes));
      durDistMap[bucket] = (durDistMap[bucket] ?? 0) + 1;
    }
  }

  const durP  = JSON.stringify(durDistMap);
  const hourP = JSON.stringify(hourMap);

  // Write into BOTH summary and summary_by_type.MO — the hotel MO dashboard reads
  // summary_by_type.MO first (falls back to summary).
  await client.query(
    `UPDATE mo_dashboard_json
        SET generated_json = jsonb_set(jsonb_set(
              CASE
                WHEN generated_json->'summary_by_type'->'MO' IS NOT NULL
                THEN jsonb_set(jsonb_set(generated_json,
                       '{summary_by_type,MO,mo_duration_dist_map}', $1::jsonb),
                       '{summary_by_type,MO,mo_hour_map}', $2::jsonb)
                ELSE generated_json
              END,
              '{summary,mo_duration_dist_map}', $1::jsonb),
              '{summary,mo_hour_map}', $2::jsonb),
            updated_at = NOW()
      WHERE id = $3`,
    [durP, hourP, dash.id]
  );
  console.log(`${dash.hotel}: ${Object.keys(durDistMap).length} dur buckets, ${Object.keys(hourMap).length} hours backfilled (${moCount > 0 ? 'MO' : 'all'} rows)`);
}

await client.end();
