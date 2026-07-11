// Backfill jo_cat_item_escalations (service_item_category → service_item →
// escalated count) into stored jo_dashboard_json summaries, aggregated from
// jo_records. Powers cjo-02's new 3-level drilldown: Hotel → Escalation Rate
// by Service Category → Escalation Rate by Service Item.
//
// Mirrors accumulateJoKpis() in app/api/uploads/finalize/route.ts:
// escalatedFlag = !!escalation_group || (delay_duration parses to minutes > 0).
//
// Usage: node scripts/backfill_jo_cat_item_escalations.mjs [DATABASE_URL]
//        (defaults to local fcs1_local)

import pg from 'pg';
const { Client } = pg;

const connectionString = process.argv[2] ?? 'postgresql://postgres:Qazz%40%402010@localhost:5432/fcs1_local';

const client = new Client({ connectionString });
await client.connect();

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
    `SELECT service_item_category, service_item, delay_duration, escalation_group
       FROM jo_records
      WHERE upload_job_id = $1`,
    [dash.upload_job_id]
  )).rows;

  if (records.length === 0) {
    console.log(`${dash.hotel}: no records — skipped`);
    continue;
  }

  const map = {};
  let escalatedTotal = 0;
  for (const r of records) {
    const delayMin = parseDurationMinutes(r.delay_duration);
    const escalatedFlag = !!(r.escalation_group && String(r.escalation_group).trim()) || (delayMin !== null && delayMin > 0);
    if (!escalatedFlag) continue;
    const cat = (r.service_item_category ?? '').trim() || '';
    const item = (r.service_item ?? '').trim() || '';
    if (!map[cat]) map[cat] = {};
    map[cat][item] = (map[cat][item] ?? 0) + 1;
    escalatedTotal++;
  }

  if (escalatedTotal === 0) {
    console.log(`${dash.hotel}: no escalated records — skipped`);
    continue;
  }

  await client.query(
    `UPDATE jo_dashboard_json
        SET generated_json = jsonb_set(generated_json, '{summary,jo_cat_item_escalations}', $1::jsonb),
            updated_at = NOW()
      WHERE id = $2`,
    [JSON.stringify(map), dash.id]
  );
  console.log(`${dash.hotel}: ${escalatedTotal} escalated records → ${Object.keys(map).length} categories backfilled`);
}

await client.end();
