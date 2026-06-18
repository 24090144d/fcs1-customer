// Backfill mo_item_date_map (defect → date → count) and mo_item_duration_map
// (defect → avg resolution hours) into stored MO dashboard summaries.
//
// Uses type = 'MO' rows when any exist for the upload, else all rows.
//
// Usage: node scripts/backfill_mo_item_maps.mjs [DATABASE_URL]

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

  const agg = (await client.query(
    `SELECT
       COALESCE(NULLIF(TRIM(defect), ''), NULLIF(TRIM(asset), ''), NULLIF(TRIM(job_order), ''), 'Unknown') AS item,
       TO_CHAR(created_datetime::date, 'YYYY-MM-DD') AS created_date,
       COUNT(*)::int AS cnt,
       AVG(EXTRACT(EPOCH FROM (completed_datetime::timestamptz - created_datetime::timestamptz)) / 3600.0)::numeric(10,4) AS avg_hours
     FROM mo_records
     WHERE upload_job_id = $1
       AND created_datetime IS NOT NULL
       ${typeFilter}
     GROUP BY 1, 2`,
    [dash.upload_job_id]
  )).rows;

  if (agg.length === 0) {
    console.log(`${dash.hotel}: no rows — skipped`);
    continue;
  }

  // Build item → date → count
  const itemDateMap = {};
  // Build item → {sum, count} for avg hours
  const itemDurAcc = {};

  for (const { item, created_date, cnt, avg_hours } of agg) {
    if (!itemDateMap[item]) itemDateMap[item] = {};
    itemDateMap[item][created_date] = cnt;

    if (avg_hours !== null) {
      if (!itemDurAcc[item]) itemDurAcc[item] = { sum: 0, count: 0 };
      itemDurAcc[item].sum += Number(avg_hours) * cnt;
      itemDurAcc[item].count += cnt;
    }
  }

  const itemDurationMap = Object.fromEntries(
    Object.entries(itemDurAcc).map(([item, v]) => [item, v.count > 0 ? v.sum / v.count : 0])
  );

  await client.query(
    `UPDATE mo_dashboard_json
        SET generated_json = jsonb_set(
              jsonb_set(generated_json, '{summary,mo_item_date_map}', $1::jsonb),
              '{summary,mo_item_duration_map}', $2::jsonb
            ),
            updated_at = NOW()
      WHERE id = $3`,
    [JSON.stringify(itemDateMap), JSON.stringify(itemDurationMap), dash.id]
  );
  console.log(`${dash.hotel}: ${Object.keys(itemDateMap).length} items backfilled (${moCount > 0 ? 'MO' : 'all'} rows)`);
}

await client.end();
