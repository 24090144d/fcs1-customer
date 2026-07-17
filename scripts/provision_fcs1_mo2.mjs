// One-time provisioning script for the fcs1-mo2 Neon project — a fresh, empty
// backup/secondary project for the "mo" customer (created because the original
// fcs1-mo Neon project hit its data-transfer quota). Resets the public schema
// (harmless on an already-empty project), applies the base schema dump
// (sql/schema.sql), applies migration 014 (idempotent, not yet baked into that
// dump), then seeds the same organization_code/organization_name the original
// fcs1-mo Vercel project uses so uploads/dashboards behave identically once
// NEON_DB_SLOT is switched to 'secondary'. Connection string is read from
// .env.neon (FCS1_MO2_DATABASE_URL_UNPOOLED) — never hardcoded in this file.
// Mirrors scripts/provision_fcs1_jp.mjs.
//
// Usage: node scripts/provision_fcs1_mo2.mjs

import pg from 'pg';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const envText = readFileSync(join(root, '.env.neon'), 'utf8');
const match = envText.match(/^FCS1_MO2_DATABASE_URL_UNPOOLED=(.+)$/m);
if (!match) {
  console.error('FCS1_MO2_DATABASE_URL_UNPOOLED not found in .env.neon');
  process.exit(1);
}
const NEON_URL = match[1].trim().replace(/^"(.*)"$/, '$1');

// Matches the existing fcs1-mo Vercel project's CUSTOMER_CODE/CUSTOMER_NAME env
// vars, so the seeded organization row lines up once traffic is switched over.
// Timezone defaults to UTC (matching scripts/init-customer-db.ps1's fresh-db
// default) — adjust via Configuration -> System after cutover if the original
// fcs1-mo org had a different timezone configured.
const CUSTOMER_CODE = 'mo';
const CUSTOMER_NAME = 'MO';

const POST_SCHEMA_MIGRATIONS = ['014_upload_jobs_hotel_identity.sql'];

const { Client } = pg;
const client = new Client({ connectionString: NEON_URL, ssl: { rejectUnauthorized: false } });

try {
  await client.connect();
  console.log('Connected to fcs1-mo2 Neon database.');

  process.stdout.write('-- resetting public schema ... ');
  await client.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
  console.log('OK');

  process.stdout.write('-- sql/schema.sql (base schema) ... ');
  const schemaSql = readFileSync(join(root, 'sql', 'schema.sql'), 'utf8');
  await client.query(schemaSql);
  console.log('OK');

  for (const file of POST_SCHEMA_MIGRATIONS) {
    const sql = readFileSync(join(root, 'sql', 'migrations', file), 'utf8');
    process.stdout.write(`-- ${file} ... `);
    await client.query(sql);
    console.log('OK');
  }

  process.stdout.write(`-- seeding organization (${CUSTOMER_CODE}) ... `);
  await client.query(
    `insert into public.organizations (organization_code, organization_name, timezone)
     values ($1, $2, 'UTC')
     on conflict (organization_code) do update
     set organization_name = excluded.organization_name`,
    [CUSTOMER_CODE, CUSTOMER_NAME]
  );
  console.log('OK');

  console.log('\nfcs1-mo2 database provisioned successfully.');
} catch (err) {
  console.error('\nProvisioning failed:', err.message);
  process.exit(1);
} finally {
  await client.end();
}
