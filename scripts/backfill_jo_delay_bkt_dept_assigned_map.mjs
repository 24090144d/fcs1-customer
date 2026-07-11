// Backfill jo_delay_bkt_dept_assigned_map (duration bucket → assigned dept →
// assigned to (user) → count for DELAYED jobs) into stored jo_dashboard_json
// summaries, aggregated from jo_records. Powers cjo-04's new 4-level
// drilldown: Hotel → Delayed Duration Distribution → Assigned Department →
// Assigned To.
//
// Mirrors accumulateJoKpis() in app/api/uploads/finalize/route.ts:
// delayed = delay_duration parses to minutes > 0 (via durBucket() boundaries);
// assigned dept/user default to 'Unknown' when blank/null, matching toStr().
//
// Usage: node scripts/backfill_jo_delay_bkt_dept_assigned_map.mjs [DATABASE_URL]
//        (defaults to local fcs1_local)

import pg from 'pg';
const { Client } = pg;

const connectionString = process.argv[2] ?? 'postgresql://postgres:Qazz%40%402010@localhost:5432/fcs1_local';

const client = new Client({ connectionString });
await client.connect();

function durBucket(minutes) {
  if (minutes < 15)  return '< 15 min';
  if (minutes < 30)  return '15–30 min';
  if (minutes < 60)  return '30–60 min';
  if (minutes < 120) return '1–2 h';
  if (minutes < 240) return '2–4 h';
  if (minutes < 480) return '4–8 h';
  return '8+ h';
}

// Mirrors lib/csv/... parseDurationMinutes()'s "HH:MM[:SS]" regex.
function parseDurationMinutes(raw) {
  const text = String(raw ?? '').trim();
  const m = text.match(/^(\d{1,3}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const hh = Number(m[1]), mm = Number(m[2]), ss = Number(m[3] ?? 0);
  return hh * 60 + mm + Math.floor(ss / 60);
}

const dashRows = (await client.query(
  `SELECT jd.id, jd.upload_job_id, jd.generated_json->'meta'->>'hotel_code' AS hotel
     FROM jo_dashboard_json jd`
)).rows;

for (const dash of dashRows) {
  const records = (await client.query(
    `SELECT delay_duration, assigned_to_department, assigned_to_user
       FROM jo_records
      WHERE upload_job_id = $1
        AND delay_duration IS NOT NULL
        AND TRIM(delay_duration) <> ''`,
    [dash.upload_job_id]
  )).rows;

  const map = {};
  let total = 0;
  for (const r of records) {
    const mins = parseDurationMinutes(r.delay_duration);
    if (mins === null || mins <= 0) continue;
    const bkt = durBucket(mins);
    const dept = (r.assigned_to_department ?? '').trim() || 'Unknown';
    const user = (r.assigned_to_user ?? '').trim() || 'Unknown';
    if (!map[bkt]) map[bkt] = {};
    if (!map[bkt][dept]) map[bkt][dept] = {};
    map[bkt][dept][user] = (map[bkt][dept][user] ?? 0) + 1;
    total++;
  }

  if (total === 0) {
    console.log(`${dash.hotel}: no delayed records — skipped`);
    continue;
  }

  await client.query(
    `UPDATE jo_dashboard_json
        SET generated_json = jsonb_set(generated_json, '{summary,jo_delay_bkt_dept_assigned_map}', $1::jsonb),
            updated_at = NOW()
      WHERE id = $2`,
    [JSON.stringify(map), dash.id]
  );
  console.log(`${dash.hotel}: ${total} delayed records → ${Object.keys(map).length} buckets backfilled`);
}

await client.end();
