// One-time orchestrator: refreshes ALL new/changed MO corp-chart data (v1.1.17/
// v1.1.18 batch: cmo-01/02/08/11/13..22) into stored mo_dashboard_json summaries
// for every customer's production Neon database listed in .env.neon, without
// needing a CSV re-upload. Combines the logic of:
//   scripts/backfill_mo_cmo13_22_maps.mjs   (mo_dim_defect_stats_map, mo_completedby_defect_stats_map)
//   scripts/backfill_mo_avgres_esclevel.mjs (mo_avg_resolution_hours, mo_esc_level_defect_map, now "EN" not "Level N")
// into one row-scan per upload job (fewer DB round trips than running both scripts
// separately). Mirrors the TS accumulation added to the MO row loop in
// app/api/uploads/finalize/route.ts:
//   - "Duration = 0 when not yet Completed" — completed_hours = completed_datetime -
//     created_datetime in hours when completed_datetime exists, else 0
//   - delayed = is_overdue (escalated, or past deadline with no/late completion)
//   - department = created_by_department (created department, not assigned)
//   - escalation level = `E${escalation_level_num ?? 0}` (was `Level N`)
//   - defect = defect ?? asset ?? job_order ?? 'Unknown'
//   - hour is computed in the org's configured timezone
//
// Usage: node scripts/backfill_mo_all_customers.mjs

import pg from 'pg';
import { readFileSync } from 'fs';
const { Client } = pg;

const CUSTOMERS = ['CN', 'HK', 'JP', 'MO', 'MY', 'NEON'];

const envText = readFileSync('.env.neon', 'utf8');

function durBucket(minutes) {
  if (minutes < 60) return '< 1h';
  if (minutes < 120) return '1-2h';
  if (minutes < 240) return '2-4h';
  if (minutes < 480) return '4-8h';
  if (minutes < 1440) return '8-24h';
  return '24h+';
}

function r2(n) { return Math.round(n * 100) / 100; }
function r1(n) { return Math.round(n * 10) / 10; }

function bump(map, dim, dimVal, defect, hours, delayed) {
  if (!map[dim]) map[dim] = {};
  if (!map[dim][dimVal]) map[dim][dimVal] = {};
  if (!map[dim][dimVal][defect]) map[dim][dimVal][defect] = { count: 0, durSum: 0, delayed: 0 };
  const a = map[dim][dimVal][defect];
  a.count += 1;
  a.durSum += hours;
  if (delayed) a.delayed += 1;
}

function toStatsMap(dm) {
  return Object.fromEntries(Object.entries(dm).map(([defect, a]) => [defect, {
    count: a.count,
    avgDurationHours: a.count > 0 ? r2(a.durSum / a.count) : 0,
    delayRate: a.count > 0 ? r1((a.delayed / a.count) * 100) : 0,
  }]));
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
      `SELECT jd.id, jd.upload_job_id,
              jd.generated_json->'meta'->>'hotel_code' AS hotel,
              COALESCE(o.timezone, 'UTC') AS org_timezone
         FROM mo_dashboard_json jd
         JOIN upload_jobs uj ON uj.id = jd.upload_job_id
         JOIN organizations o ON o.id = uj.organization_id`
    )).rows;

    if (dashRows.length === 0) {
      console.log('  No mo_dashboard_json rows — no MO data uploaded for this customer yet.');
      return;
    }

    for (const dash of dashRows) {
      const tz = dash.org_timezone;

      const rows = (await client.query(
        `SELECT
           COALESCE(NULLIF(defect, ''), NULLIF(asset, ''), NULLIF(job_order, ''), 'Unknown') AS defect,
           COALESCE(NULLIF(category, ''), 'Uncategorized') AS category,
           COALESCE(NULLIF(created_by_department, ''), 'Unknown') AS department,
           COALESCE(NULLIF(guest_related, ''), 'N') AS guest_related,
           COALESCE(NULLIF(type, ''), 'MO') AS type,
           COALESCE(NULLIF(job_status, ''), 'Unknown') AS job_status,
           COALESCE(NULLIF(completed_by, ''), 'Unknown') AS completed_by,
           COALESCE(escalation_level_num, 0) AS esc_level,
           is_overdue,
           COALESCE(created_hour, EXTRACT(HOUR FROM created_datetime AT TIME ZONE $2)::int) AS hour,
           created_datetime,
           completed_datetime,
           resolution_minutes AS resolution_min
         FROM mo_records
         WHERE upload_job_id = $1
           AND created_datetime IS NOT NULL`,
        [dash.upload_job_id, tz]
      )).rows;

      if (rows.length === 0) {
        console.log(`  ${dash.hotel} (${tz}): no rows — skipped`);
        continue;
      }

      const dimDefectAcc = {};
      const completedByDefectAcc = {};
      let durSum = 0, durCount = 0;
      const escLevelDefect = {};

      for (const r of rows) {
        const hours = r.completed_datetime
          ? Math.max(0, (new Date(r.completed_datetime).getTime() - new Date(r.created_datetime).getTime()) / 3600000)
          : 0;
        const durBktKey = durBucket(hours * 60);
        const guestKey = /^(y|yes|true|1)$/i.test(String(r.guest_related)) ? 'Guest Related' : 'Non Guest Related';
        const otKey = r.is_overdue ? 'Delayed' : 'On Time';
        const escKey = `E${r.esc_level ?? 0}`;
        const delayed = !!r.is_overdue;

        bump(dimDefectAcc, 'category', r.category, r.defect, hours, delayed);
        bump(dimDefectAcc, 'department', r.department, r.defect, hours, delayed);
        bump(dimDefectAcc, 'guest', guestKey, r.defect, hours, delayed);
        bump(dimDefectAcc, 'ontime', otKey, r.defect, hours, delayed);
        bump(dimDefectAcc, 'type', r.type, r.defect, hours, delayed);
        bump(dimDefectAcc, 'durbkt', durBktKey, r.defect, hours, delayed);
        if (r.hour !== null && r.hour !== undefined) {
          bump(dimDefectAcc, 'hour', String(r.hour).padStart(2, '0'), r.defect, hours, delayed);
        }
        bump(dimDefectAcc, 'esclevel', escKey, r.defect, hours, delayed);
        bump(dimDefectAcc, 'status', r.job_status, r.defect, hours, delayed);

        if (!completedByDefectAcc[r.completed_by]) completedByDefectAcc[r.completed_by] = {};
        if (!completedByDefectAcc[r.completed_by][r.defect]) completedByDefectAcc[r.completed_by][r.defect] = { count: 0, durSum: 0, delayed: 0 };
        const cbAcc = completedByDefectAcc[r.completed_by][r.defect];
        cbAcc.count += 1;
        cbAcc.durSum += hours;
        if (delayed) cbAcc.delayed += 1;

        if (r.resolution_min !== null && r.resolution_min !== undefined) {
          durSum += Number(r.resolution_min);
          durCount += 1;
        }
        if (!escLevelDefect[escKey]) escLevelDefect[escKey] = {};
        escLevelDefect[escKey][r.defect] = (escLevelDefect[escKey][r.defect] ?? 0) + 1;
      }

      const dimDefectStatsMap = Object.fromEntries(
        Object.entries(dimDefectAcc).map(([dim, dimMap]) => [
          dim,
          Object.fromEntries(Object.entries(dimMap).map(([dimVal, dm]) => [dimVal, toStatsMap(dm)])),
        ]),
      );
      const completedByDefectStatsMap = Object.fromEntries(
        Object.entries(completedByDefectAcc).map(([person, dm]) => [person, toStatsMap(dm)]),
      );
      const avgResolutionHours = durCount > 0 ? r2(durSum / durCount / 60) : 0;

      const p1 = JSON.stringify(dimDefectStatsMap);
      const p2 = JSON.stringify(completedByDefectStatsMap);
      const p3 = JSON.stringify(avgResolutionHours);
      const p4 = JSON.stringify(escLevelDefect);

      await client.query(
        `UPDATE mo_dashboard_json
            SET generated_json = jsonb_set(
                  CASE
                    WHEN generated_json->'summary_by_type'->'MO' IS NOT NULL
                    THEN jsonb_set(jsonb_set(jsonb_set(jsonb_set(generated_json,
                           '{summary_by_type,MO,mo_dim_defect_stats_map}', $1::jsonb),
                           '{summary_by_type,MO,mo_completedby_defect_stats_map}', $2::jsonb),
                           '{summary_by_type,MO,mo_avg_resolution_hours}', $3::jsonb),
                           '{summary_by_type,MO,mo_esc_level_defect_map}', $4::jsonb)
                    ELSE generated_json
                  END,
                  '{summary,mo_dim_defect_stats_map}', $1::jsonb),
                updated_at = NOW()
          WHERE id = $5`,
        [p1, p2, p3, p4, dash.id]
      );
      await client.query(
        `UPDATE mo_dashboard_json
            SET generated_json = jsonb_set(jsonb_set(jsonb_set(
                  generated_json,
                  '{summary,mo_completedby_defect_stats_map}', $1::jsonb),
                  '{summary,mo_avg_resolution_hours}', $2::jsonb),
                  '{summary,mo_esc_level_defect_map}', $3::jsonb),
                updated_at = NOW()
          WHERE id = $4`,
        [p2, p3, p4, dash.id]
      );

      console.log(`  ${dash.hotel} (${tz}): ${rows.length} rows -> dims=${Object.keys(dimDefectStatsMap).length}, completed_by=${Object.keys(completedByDefectStatsMap).length}, avg_resolution_hours=${avgResolutionHours}, esc_levels=${Object.keys(escLevelDefect).length} backfilled`);
    }
  } catch (err) {
    console.log(`  Error: ${err.message}`);
  } finally {
    await client.end();
  }
}

for (const code of CUSTOMERS) {
  await backfillCustomer(code);
}
