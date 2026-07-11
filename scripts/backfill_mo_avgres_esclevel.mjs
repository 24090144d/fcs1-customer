// Backfill mo_avg_resolution_hours (hotel-level average resolution/completed
// duration, in hours) and mo_esc_level_defect_map (escalation level "Level N"
// → defect → count) into stored MO dashboard summaries.
//
// Mirrors the TS accumulation added to the MO row loop in
// app/api/uploads/finalize/route.ts:
//   - resolution duration = resolution_minutes column, averaged then /60 for hours
//   - escalation level = `Level ${escalation_level ?? 0}`
//   - defect = defect ?? asset ?? job_order ?? 'Unknown'
//
// Usage: node scripts/backfill_mo_avgres_esclevel.mjs [DATABASE_URL]

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
  const rows = (await client.query(
    `SELECT
       COALESCE(NULLIF(defect, ''), NULLIF(asset, ''), NULLIF(job_order, ''), 'Unknown') AS defect,
       COALESCE(escalation_level, '0') AS escalation_level,
       resolution_minutes AS resolution_min
     FROM mo_records
     WHERE upload_job_id = $1`,
    [dash.upload_job_id]
  )).rows;

  if (rows.length === 0) {
    console.log(`${dash.hotel}: no rows — skipped`);
    continue;
  }

  let durSum = 0, durCount = 0;
  const escLevelDefect = {};

  for (const { defect, escalation_level, resolution_min } of rows) {
    if (resolution_min !== null && resolution_min !== undefined) {
      durSum += Number(resolution_min);
      durCount += 1;
    }
    const lvlKey = `Level ${escalation_level}`;
    if (!escLevelDefect[lvlKey]) escLevelDefect[lvlKey] = {};
    escLevelDefect[lvlKey][defect] = (escLevelDefect[lvlKey][defect] ?? 0) + 1;
  }

  const avgHours = durCount > 0 ? Number((durSum / durCount / 60).toFixed(2)) : 0;
  const p1 = JSON.stringify(avgHours);
  const p2 = JSON.stringify(escLevelDefect);

  await client.query(
    `UPDATE mo_dashboard_json
        SET generated_json = jsonb_set(
              CASE
                WHEN generated_json->'summary_by_type'->'MO' IS NOT NULL
                THEN jsonb_set(jsonb_set(generated_json,
                       '{summary_by_type,MO,mo_avg_resolution_hours}', $1::jsonb),
                       '{summary_by_type,MO,mo_esc_level_defect_map}', $2::jsonb)
                ELSE generated_json
              END,
              '{summary,mo_avg_resolution_hours}', $1::jsonb),
            updated_at = NOW()
      WHERE id = $3`,
    [p1, p2, dash.id]
  );
  await client.query(
    `UPDATE mo_dashboard_json
        SET generated_json = jsonb_set(generated_json, '{summary,mo_esc_level_defect_map}', $1::jsonb),
            updated_at = NOW()
      WHERE id = $2`,
    [p2, dash.id]
  );

  console.log(`${dash.hotel}: ${rows.length} rows → avg_resolution_hours=${avgHours}, esc_levels=${Object.keys(escLevelDefect).length} backfilled`);
}

await client.end();
