/**
 * backfill_jo_hour_maps.mjs
 *
 * Backfills 9 missing hour-level summary maps into existing jo_dashboard_json rows.
 * Run once after deploying the cjo-23..26 redesign.
 *
 * Targets both localhost AND Neon sequentially.
 *
 * Usage:
 *   node scripts/backfill_jo_hour_maps.mjs
 */

import pg from 'pg';

const DATABASES = [
  {
    label: 'localhost',
    url: 'postgresql://postgres:Qazz%40%402010@localhost:5432/fcs1_local',
  },
  {
    label: 'Neon',
    url: 'postgresql://neondb_owner:npg_WA1yvrktU6NP@ep-square-glitter-apw48qoo.c-7.us-east-1.aws.neon.tech/neondb?sslmode=require',
  },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

const DUR_BUCKETS = ['< 15 min', '15–30 min', '30–60 min', '1–2 h', '2–4 h', '4–8 h', '8+ h'];

function durBucket(mins) {
  if (mins <  15) return '< 15 min';
  if (mins <  30) return '15–30 min';
  if (mins <  60) return '30–60 min';
  if (mins < 120) return '1–2 h';
  if (mins < 240) return '2–4 h';
  if (mins < 480) return '4–8 h';
  return '8+ h';
}

/** Parse "HH:MM" or plain number → total minutes, null if unparseable. */
function parseDurationMinutes(raw) {
  const s = (raw ?? '').toString().trim();
  if (!s) return null;
  const m = s.match(/^(\d+):(\d{2})(?::(\d{2}))?$/);
  if (m) {
    const hh = parseInt(m[1], 10);
    const mm = parseInt(m[2], 10);
    const ss = m[3] ? parseInt(m[3], 10) : 0;
    return hh * 60 + mm + Math.floor(ss / 60);
  }
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

function completedFlag(status) {
  const s = (status ?? '').toLowerCase();
  return s.includes('complete') || s.includes('close') || s.includes('done') || s.includes('finish');
}

function escalatedFlag(escalationGroup, delayMin) {
  // escalation_group is often absent; treat any positive delay as escalated/overdue
  return !!(escalationGroup && escalationGroup.toString().trim()) || (delayMin !== null && delayMin > 0);
}

function inc(obj, key) {
  obj[key] = (obj[key] ?? 0) + 1;
}
function inc2(obj, h, key) {
  if (!obj[h]) obj[h] = {};
  obj[h][key] = (obj[h][key] ?? 0) + 1;
}

// ── Core computation ─────────────────────────────────────────────────────────

function computeHourMaps(rows) {
  const hourCompleted      = {};
  const hourCompBkt        = {};
  const hourRespBkt        = {};
  const hourEsc            = {};
  const hourEscBkt         = {};
  const hourSlaTotal       = {};
  const hourSlaComp        = {};
  const hourSlaCatTotal    = {};
  const hourSlaCatComp     = {};

  for (const row of rows) {
    const status       = row.job_status ?? '';
    const category     = (row.service_item_category ?? 'Unknown').trim() || 'Unknown';
    const createdAt    = row.created_datetime;   // timestamptz → JS Date from pg driver
    const ackAt        = row.acknowledged_datetime;
    const completedAt  = row.completed_datetime;
    const escGroup     = row.escalation_group;
    const delayRaw     = row.delay_duration;

    const isCompleted  = completedFlag(status);
    const delayMin     = parseDurationMinutes(delayRaw);
    const isEscalated  = escalatedFlag(escGroup, delayMin);
    const isSlaComp    = !(delayMin !== null && delayMin > 0);

    // Extract created-at hour (pg driver returns JS Date for timestamptz)
    if (!createdAt) continue;
    const createdDate  = createdAt instanceof Date ? createdAt : new Date(createdAt);
    if (isNaN(createdDate.getTime())) continue;
    const h = createdDate.getHours();

    // hourSlaTotal — every job
    inc(hourSlaTotal, h);

    // cjo-23: completed + completion duration bucket
    if (isCompleted) {
      inc(hourCompleted, h);

      // resolutionMin = completed_datetime - created_datetime
      if (completedAt) {
        const t1 = createdDate.getTime();
        const t2 = (completedAt instanceof Date ? completedAt : new Date(completedAt)).getTime();
        if (!isNaN(t2) && t2 >= t1) {
          const resMin = (t2 - t1) / 60_000;
          inc2(hourCompBkt, h, durBucket(resMin));
        }
      }

      // cjo-26: SLA compliance per hour + category drilldown
      if (isSlaComp) inc(hourSlaComp, h);
      inc2(hourSlaCatTotal, h, category);
      if (isSlaComp) inc2(hourSlaCatComp, h, category);
    }

    // cjo-24: acknowledged (have both created + acknowledged timestamps)
    if (ackAt) {
      const t1 = createdDate.getTime();
      const t2 = (ackAt instanceof Date ? ackAt : new Date(ackAt)).getTime();
      if (!isNaN(t2) && t2 >= t1) {
        const respMin = (t2 - t1) / 60_000;
        inc2(hourRespBkt, h, durBucket(respMin));
      }
    }

    // cjo-25: escalated + overdue duration bucket
    if (isEscalated) {
      inc(hourEsc, h);
      if (delayMin !== null) {
        inc2(hourEscBkt, h, durBucket(delayMin));
      }
    }
  }

  return {
    jo_hour_comp_map:           hourCompleted,
    jo_hour_comp_bkt_map:       hourCompBkt,
    jo_hour_resp_bkt_map:       hourRespBkt,
    jo_hour_esc_map:            hourEsc,
    jo_hour_esc_bkt_map:        hourEscBkt,
    jo_hour_sla_total_map:      hourSlaTotal,
    jo_hour_sla_comp_map:       hourSlaComp,
    jo_hour_sla_cat_total_map:  hourSlaCatTotal,
    jo_hour_sla_cat_comp_map:   hourSlaCatComp,
  };
}

// ── Per-database runner ───────────────────────────────────────────────────────

async function backfillDb({ label, url }) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  ${label}`);
  console.log(`${'═'.repeat(60)}`);

  const client = new pg.Client({ connectionString: url });
  await client.connect();

  // 1. Fetch all JO dashboard rows
  const { rows: dashRows } = await client.query(
    `SELECT upload_job_id, generated_json FROM jo_dashboard_json ORDER BY updated_at`,
  );
  console.log(`  Found ${dashRows.length} JO dashboard row(s).`);

  let updated = 0;
  let skipped = 0;

  for (const dash of dashRows) {
    const jobId = dash.upload_job_id;
    const json  = dash.generated_json;

    // 2. Fetch all jo_records for this upload job
    const { rows: records } = await client.query(
      `SELECT job_status, service_item_category,
              created_datetime, acknowledged_datetime, completed_datetime,
              escalation_group, delay_duration
       FROM jo_records
       WHERE upload_job_id = $1`,
      [jobId],
    );

    if (records.length === 0) {
      console.log(`  [SKIP] ${jobId} — no jo_records found`);
      skipped++;
      continue;
    }

    // 3. Compute new maps
    const newMaps = computeHourMaps(records);

    // 4. Merge into summary
    const summary = json.summary ?? {};
    Object.assign(summary, newMaps);
    json.summary = summary;

    // 5. Update dashboard row
    await client.query(
      `UPDATE jo_dashboard_json
          SET generated_json = $1, updated_at = NOW()
        WHERE upload_job_id = $2`,
      [JSON.stringify(json), jobId],
    );

    const totalJobs = Object.values(newMaps.jo_hour_sla_total_map).reduce((s, v) => s + v, 0);
    console.log(`  [OK]   ${jobId} — ${records.length} records, ${totalJobs} jobs across hours`);
    updated++;
  }

  console.log(`\n  Done. Updated: ${updated}  Skipped: ${skipped}`);
  await client.end();
}

// ── Main ──────────────────────────────────────────────────────────────────────

for (const db of DATABASES) {
  try {
    await backfillDb(db);
  } catch (err) {
    console.error(`\n❌ ${db.label} FAILED: ${err.message}`);
    process.exit(1);
  }
}

console.log('\n✅ Backfill complete on all databases.\n');
