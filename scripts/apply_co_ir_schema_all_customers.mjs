import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const { Client } = pg;
const root = process.cwd();
const envPath = path.join(root, '.env.neon');
const migrationPath = path.join(root, 'sql', 'migrations', '015_co_ir_schema.sql');

function parseEnv(text) {
  const values = new Map();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values.set(key, value);
  }
  return values;
}

if (!fs.existsSync(envPath)) {
  throw new Error(`Missing ${envPath}`);
}

const env = parseEnv(fs.readFileSync(envPath, 'utf8'));
const migration = fs.readFileSync(migrationPath, 'utf8');
const requestedAliases = new Set(process.argv.slice(2).map((value) => value.trim().toUpperCase()).filter(Boolean));
const targets = [...env.entries()]
  .filter(([key, value]) => /^FCS1_[A-Z0-9]+_DATABASE_URL_UNPOOLED$/.test(key) && value)
  .map(([key, connectionString]) => ({
    alias: key.replace(/^FCS1_/, '').replace(/_DATABASE_URL_UNPOOLED$/, ''),
    connectionString,
  }))
  .filter((target) => requestedAliases.size === 0 || requestedAliases.has(target.alias))
  .sort((a, b) => a.alias.localeCompare(b.alias, undefined, { numeric: true }));

if (targets.length === 0) {
  throw new Error('No FCS1_*_DATABASE_URL_UNPOOLED targets found in .env.neon');
}

const failures = [];
for (const target of targets) {
  const client = new Client({ connectionString: target.connectionString, connectionTimeoutMillis: 15_000 });
  try {
    process.stdout.write(`[${target.alias}] applying CO-IR schema... `);
    await client.connect();
    await client.query('begin');
    await client.query(migration);
    await client.query('commit');

    const verification = await client.query(`
      select
        to_regclass('public.co_ir_records') is not null as table_exists,
        (select count(*)::int from information_schema.columns
          where table_schema = 'public' and table_name = 'co_ir_records') as column_count,
        (select count(*)::int from pg_indexes
          where schemaname = 'public' and tablename = 'co_ir_records') as index_count
    `);
    const result = verification.rows[0];
    if (!result.table_exists || result.column_count < 28 || result.index_count < 7) {
      throw new Error(`verification failed (columns=${result.column_count}, indexes=${result.index_count})`);
    }
    console.log(`OK (${result.column_count} columns, ${result.index_count} indexes)`);
  } catch (error) {
    try { await client.query('rollback'); } catch {}
    const message = error instanceof Error ? error.message : String(error);
    console.log(`FAILED: ${message}`);
    failures.push(`${target.alias}: ${message}`);
  } finally {
    await client.end().catch(() => {});
  }
}

if (failures.length > 0) {
  console.error(`CO-IR migration failed for ${failures.length}/${targets.length} database(s).`);
  process.exitCode = 1;
} else {
  console.log(`CO-IR schema verified on all ${targets.length} configured Neon database(s).`);
}
