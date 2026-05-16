#!/usr/bin/env node
/*
  Safe retention cleanup for Neon storage.

  Rules:
  - Keep all non-completed jobs.
  - For completed jobs that have dashboard rows (finalized), keep only latest N per (module, hotel_code).
  - For completed jobs without dashboard rows, keep latest M per module as safety buffer.
  - Delete older jobs from upload_jobs (CASCADE removes staging/records/dashboard rows).

  Usage:
    node scripts/cleanup-retention.js --dry-run
    node scripts/cleanup-retention.js --apply --keep-per-hotel=1 --keep-orphans-per-module=1
*/

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

function loadEnvLocal() {
  const p = path.join(process.cwd(), '.env.local');
  if (!fs.existsSync(p)) return;
  const raw = fs.readFileSync(p, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith('#')) continue;
    const i = s.indexOf('=');
    if (i < 0) continue;
    const k = s.slice(0, i).trim();
    let v = s.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!process.env[k]) process.env[k] = v;
  }
}

function argValue(name, fallback) {
  const prefix = `${name}=`;
  const found = process.argv.find((a) => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function hasArg(name) {
  return process.argv.includes(name);
}

function toInt(v, dflt) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : dflt;
}

async function main() {
  loadEnvLocal();

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL not set (expected in env or .env.local).');
  }

  const apply = hasArg('--apply');
  const dryRun = !apply || hasArg('--dry-run');
  const keepPerHotel = toInt(argValue('--keep-per-hotel', '1'), 1);
  const keepOrphansPerModule = toInt(argValue('--keep-orphans-per-module', '1'), 1);
  const pruneCompletedStaging = hasArg('--prune-completed-staging');

  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();

  const before = await client.query(`
    select relname as table, pg_total_relation_size(c.oid) as bytes
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname='public' and c.relkind='r'
    order by bytes desc
  `);

  const rows = await client.query(`
    with dashboards as (
      select upload_job_id, 'im'::text as module_code, generated_at, generated_json->'meta'->>'hotel_code' as hotel_code
      from im_dashboard_json
      union all
      select upload_job_id, 'jo'::text as module_code, generated_at, generated_json->'meta'->>'hotel_code' as hotel_code
      from jo_dashboard_json
    ),
    jobs as (
      select j.id, j.module_code::text as module_code, j.status, j.created_at,
             d.generated_at,
             coalesce(nullif(d.hotel_code, ''), 'UNKNOWN') as hotel_code,
             (d.upload_job_id is not null) as has_dashboard
      from upload_jobs j
      left join dashboards d on d.upload_job_id = j.id
    ),
    ranked as (
      select *,
        case when has_dashboard then
          row_number() over (partition by module_code, hotel_code order by coalesce(generated_at, created_at) desc, created_at desc)
        else null end as rn_hotel,
        case when not has_dashboard then
          row_number() over (partition by module_code order by created_at desc)
        else null end as rn_orphan
      from jobs
      where status = 'completed'
    )
    select * from ranked
    order by module_code, hotel_code, created_at desc
  `);

  const toDelete = [];
  const keep = [];

  for (const r of rows.rows) {
    if (r.has_dashboard) {
      if (r.rn_hotel > keepPerHotel) toDelete.push(r);
      else keep.push(r);
      continue;
    }
    if (r.rn_orphan > keepOrphansPerModule) toDelete.push(r);
    else keep.push(r);
  }

  console.log(JSON.stringify({
    mode: dryRun ? 'dry-run' : 'apply',
    keepPerHotel,
    keepOrphansPerModule,
    pruneCompletedStaging,
    keepCount: keep.length,
    deleteCount: toDelete.length,
    deletePreview: toDelete.slice(0, 20).map((r) => ({
      id: r.id,
      module: r.module_code,
      hotel: r.hotel_code,
      has_dashboard: r.has_dashboard,
      created_at: r.created_at,
    })),
  }, null, 2));

  if (!dryRun) {
    const ids = toDelete.map((r) => r.id);
    await client.query('begin');
    try {
      let del = { rowCount: 0 };
      if (ids.length > 0) {
        del = await client.query('delete from upload_jobs where id = any($1::uuid[]) returning id', [ids]);
      }

      let pruned = { jo: 0, im: 0 };
      if (pruneCompletedStaging) {
        const joNull = await client.query(`
          update jo_records r
          set source_row_id = null
          from upload_jobs j
          where r.upload_job_id = j.id
            and j.status = 'completed'
            and r.source_row_id is not null
        `);
        const imNull = await client.query(`
          update im_records r
          set source_row_id = null
          from upload_jobs j
          where r.upload_job_id = j.id
            and j.status = 'completed'
            and r.source_row_id is not null
        `);
        const joDel = await client.query(`
          delete from jo_staging_rows s
          using upload_jobs j
          where s.upload_job_id = j.id
            and j.status = 'completed'
        `);
        const imDel = await client.query(`
          delete from im_staging_rows s
          using upload_jobs j
          where s.upload_job_id = j.id
            and j.status = 'completed'
        `);
        pruned = { jo: joDel.rowCount || 0, im: imDel.rowCount || 0 };
        console.log(`Detached source_row_id refs: jo=${joNull.rowCount || 0}, im=${imNull.rowCount || 0}`);
      }

      await client.query('commit');
      console.log(`Deleted ${del.rowCount} upload_jobs (cascade).`);
      if (pruneCompletedStaging) {
        console.log(`Pruned completed staging rows: jo=${pruned.jo}, im=${pruned.im}`);
      }
    } catch (e) {
      await client.query('rollback');
      throw e;
    }
  }

  const after = await client.query(`
    select relname as table, pg_total_relation_size(c.oid) as bytes
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname='public' and c.relkind='r'
    order by bytes desc
  `);

  const sum = (arr) => arr.reduce((a, x) => a + Number(x.bytes || 0), 0);
  const beforeBytes = sum(before.rows);
  const afterBytes = sum(after.rows);

  console.log(JSON.stringify({
    storageBeforeBytes: beforeBytes,
    storageAfterBytes: afterBytes,
    reclaimedBytesEstimate: Math.max(0, beforeBytes - afterBytes),
    topTablesAfter: after.rows.slice(0, 6),
  }, null, 2));

  await client.end();
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
