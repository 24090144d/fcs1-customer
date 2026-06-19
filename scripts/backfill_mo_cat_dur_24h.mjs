// Backfill mo_cat_duration_map (category → avg resolution hours)
// and mo_item_24h_date_map (defect → date → count for orders >= 1440 min)
// into stored MO dashboard summaries, computed from mo_records.
//
// Uses type = 'MO' rows when any exist for the upload, else all rows.
//
// Usage: node scripts/backfill_mo_cat_dur_24h.mjs [DATABASE_URL]

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
  const moCount = Number((await client.query(
    `SELECT COUNT(*)::int AS n FROM mo_records WHERE upload_job_id = $1 AND type = 'MO'`,
    [dash.upload_job_id]
  )).rows[0]?.n ?? 0);
  const typeFilter = moCount > 0 ? `AND type = 'MO'` : '';

  const rows = (await client.query(
    `SELECT COALESCE(NULLIF(TRIM(category), ''), 'Uncategorized') AS cat,
            COALESCE(NULLIF(TRIM(defect), ''), 'Uncategorized')  AS defect,
            resolution_minutes,
            TO_CHAR(created_date, 'YYYY-MM-DD') AS created_date
       FROM mo_records
      WHERE upload_job_id = $1
        ${typeFilter}`,
    [dash.upload_job_id]
  )).rows;

  if (rows.length === 0) {
    console.log(`${dash.hotel}: no rows — skipped`);
    continue;
  }

  // mo-06: category → { sum, count } → avg hours
  const catDurAcc = {};
  // mo-11: defect → date → count  (only for resolution_minutes >= 1440)
  const item24hDateAcc = {};

  for (const { cat, defect, resolution_minutes, created_date } of rows) {
    const mins = resolution_minutes !== null ? Number(resolution_minutes) : null;
    if (mins !== null) {
      if (!catDurAcc[cat]) catDurAcc[cat] = { sum: 0, count: 0 };
      catDurAcc[cat].sum += mins;
      catDurAcc[cat].count += 1;

      if (mins >= 1440 && created_date) {
        if (!item24hDateAcc[defect]) item24hDateAcc[defect] = {};
        item24hDateAcc[defect][created_date] = (item24hDateAcc[defect][created_date] ?? 0) + 1;
      }
    }
  }

  const moCatDurationMap = Object.fromEntries(
    Object.entries(catDurAcc).map(([c, v]) => [c, v.count > 0 ? v.sum / v.count / 60 : 0])
  );
  const moItem24hDateMap = Object.fromEntries(
    Object.entries(item24hDateAcc).map(([item, dm]) => [item, { ...dm }])
  );

  const catP  = JSON.stringify(moCatDurationMap);
  const i24P  = JSON.stringify(moItem24hDateMap);

  await client.query(
    `UPDATE mo_dashboard_json
        SET generated_json = jsonb_set(jsonb_set(
              CASE
                WHEN generated_json->'summary_by_type'->'MO' IS NOT NULL
                THEN jsonb_set(jsonb_set(generated_json,
                       '{summary_by_type,MO,mo_cat_duration_map}', $1::jsonb),
                       '{summary_by_type,MO,mo_item_24h_date_map}', $2::jsonb)
                ELSE generated_json
              END,
              '{summary,mo_cat_duration_map}', $1::jsonb),
              '{summary,mo_item_24h_date_map}', $2::jsonb),
            updated_at = NOW()
      WHERE id = $3`,
    [catP, i24P, dash.id]
  );

  console.log(`${dash.hotel}: ${Object.keys(moCatDurationMap).length} categories, ${Object.keys(moItem24hDateMap).length} 24h+ defects backfilled (${moCount > 0 ? 'MO' : 'all'} rows)`);
}

await client.end();
