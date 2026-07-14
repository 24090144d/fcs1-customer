// One-time orchestrator: runs the im_cat_item_dur_bkt_map backfill (cim-18/cim-19
// data) against every customer's production Neon database listed in .env.neon,
// without needing a CSV re-upload. Close time = investigation_updated_on_2,
// falling back to investigation_updated_on_1; if neither is present, a fixed
// 48h duration is assumed (24h+ bucket) rather than dropping the record.
// Reuses the same logic as scripts/backfill_im_cat_item_dur_bkt_map.mjs and
// app/api/uploads/finalize/route.ts.
//
// Usage: node scripts/backfill_im_cat_item_dur_bkt_map_all_customers.mjs

import pg from 'pg';
import { readFileSync } from 'fs';
const { Client } = pg;

const CUSTOMERS = ['CN', 'HK', 'JP', 'MO', 'MY', 'NEON'];

const envText = readFileSync('.env.neon', 'utf8');

function bucketFor(hours) {
  if (hours < 1) return '< 1h';
  if (hours < 2) return '1-2h';
  if (hours < 4) return '2-4h';
  if (hours < 8) return '4-8h';
  if (hours < 24) return '8-24h';
  return '24h+';
}

async function backfillCustomer(code) {
  const match = envText.match(new RegExp(`^FCS1_${code}_DATABASE_URL_UNPOOLED=(.+)$`, 'm'));
  if (!match) {
    console.log(`\n=== ${code}: no DATABASE_URL_UNPOOLED found in .env.neon — skipped ===`);
    return;
  }
  const url = match[1].trim().replace(/^"(.*)"$/, '$1');

  console.log(`\n=== ${code} ===`);
  const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  try {
    await client.connect();
  } catch (err) {
    console.log(`  Connection failed: ${err.message} — skipped`);
    return;
  }

  try {
    const dashRows = (await client.query(
      `SELECT id, upload_job_id, generated_json->'meta'->>'hotel_code' AS hotel
         FROM im_dashboard_json`
    )).rows;

    if (dashRows.length === 0) {
      console.log('  No im_dashboard_json rows — no IM data uploaded for this customer yet.');
      return;
    }

    for (const dash of dashRows) {
      const agg = (await client.query(
        `WITH base AS (
           SELECT COALESCE(NULLIF(TRIM(incident_category), ''), 'Unknown') AS category,
                  COALESCE(NULLIF(TRIM(incident_item_name), ''), 'Unknown') AS item,
                  COALESCE(investigation_updated_on_2, investigation_updated_on_1) AS closed_ts,
                  COALESCE(incident_datetime, created_date) AS start_ts
             FROM im_records
            WHERE upload_job_id = $1
              AND COALESCE(incident_datetime, created_date) IS NOT NULL
         )
         SELECT category, item,
                CASE WHEN closed_ts IS NULL THEN 48
                     ELSE EXTRACT(EPOCH FROM (closed_ts - start_ts)) / 3600.0
                END AS hours
           FROM base
          WHERE closed_ts IS NULL
             OR (closed_ts >= start_ts AND EXTRACT(EPOCH FROM (closed_ts - start_ts)) / 3600.0 < 3650 * 24)`,
        [dash.upload_job_id]
      )).rows;

      if (agg.length === 0) {
        console.log(`  ${dash.hotel}: no duration records — skipped`);
        continue;
      }

      const catItemDurBktMap = {};
      for (const { category, item, hours } of agg) {
        const bkt = bucketFor(parseFloat(hours));
        if (!catItemDurBktMap[category]) catItemDurBktMap[category] = {};
        if (!catItemDurBktMap[category][item]) catItemDurBktMap[category][item] = {};
        catItemDurBktMap[category][item][bkt] = (catItemDurBktMap[category][item][bkt] ?? 0) + 1;
      }

      await client.query(
        `UPDATE im_dashboard_json
            SET generated_json = jsonb_set(generated_json, '{summary,im_cat_item_dur_bkt_map}', $1::jsonb),
                updated_at = NOW()
          WHERE id = $2`,
        [JSON.stringify(catItemDurBktMap), dash.id]
      );
      console.log(`  ${dash.hotel}: ${agg.length} records → ${Object.keys(catItemDurBktMap).length} categories backfilled`);
    }
  } finally {
    await client.end();
  }
}

for (const code of CUSTOMERS) {
  await backfillCustomer(code);
}
