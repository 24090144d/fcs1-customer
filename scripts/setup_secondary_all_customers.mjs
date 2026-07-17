// One-time orchestrator: for every customer except MO (already done manually),
// (1) provisions the secondary Neon project's schema (mirrors provision_fcs1_mo2.mjs:
//     reset public schema, apply sql/schema.sql, apply migration 014, seed the
//     organizations row with the SAME organization_code/name/timezone as the
//     customer's primary project, read live off the primary DB since it isn't
//     quota-blocked), and
// (2) wires DATABASE_URL_SECONDARY / DATABASE_URL_UNPOOLED_SECONDARY / NEON_DB_SLOT
//     onto the customer's live Vercel project, scoped to All Environments
//     (Production+Preview+Development), via the Vercel REST API directly (the
//     `vercel env add <name> preview` CLI has a bug that loops on the git-branch
//     prompt even for its own suggested "all Preview branches" command).
//
// NEON_DB_SLOT is set to 'primary' for all of these (NOT 'secondary') — none of
// these customers are in a quota crisis like fcs1-mo was, so this only wires the
// secondary DB as a ready-to-go failover without touching any live traffic.
//
// Usage: node scripts/setup_secondary_all_customers.mjs

import pg from 'pg';
import { readFileSync } from 'fs';
const { Client } = pg;

const TEAM_ID = 'team_WzGdIWjY9hkSK8zvKusdgaTI';
const CUSTOMERS = [
  { code: 'CN', vercelProject: 'fcs1-cn', projectId: 'prj_pzyAelnAKkdv26Ck1DGASGXVf3tl' },
  { code: 'HK', vercelProject: 'fcs1-hk', projectId: 'prj_3bJFKqCHqXzLafTVZrd1AITQVwNT' },
  { code: 'JP', vercelProject: 'fcs1-jp', projectId: 'prj_VRKXCFfKH9NCOOafzkiXIyRo0EMi' },
  { code: 'MY', vercelProject: 'fcs1-my', projectId: 'prj_XDoNit3ulc4TNZEXpaepI9pR9OuA' },
  { code: 'NEON', vercelProject: 'fcs1-neon', projectId: 'prj_UfkaTXvnALyifFgVqCPiBnF6CmMF' },
];

const authPath = 'C:/Users/William.Choo/AppData/Roaming/xdg.data/com.vercel.cli/auth.json';
const { token } = JSON.parse(readFileSync(authPath, 'utf8'));
const API = 'https://api.vercel.com';
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

const envText = readFileSync('.env.neon', 'utf8');
function envVal(name) {
  const m = envText.match(new RegExp(`^${name}=(.+)$`, 'm'));
  if (!m) throw new Error(`${name} not found in .env.neon`);
  return m[1].trim().replace(/^"(.*)"$/, '$1');
}

async function listEnvs(projectId) {
  const res = await fetch(`${API}/v10/projects/${projectId}/env?teamId=${TEAM_ID}`, { headers });
  if (!res.ok) throw new Error(`list envs failed: ${res.status} ${await res.text()}`);
  return (await res.json()).envs ?? [];
}

async function deleteEnv(projectId, id) {
  const res = await fetch(`${API}/v9/projects/${projectId}/env/${id}?teamId=${TEAM_ID}`, { method: 'DELETE', headers });
  if (!res.ok) throw new Error(`delete env ${id} failed: ${res.status} ${await res.text()}`);
}

async function createEnv(projectId, key, value) {
  const res = await fetch(`${API}/v10/projects/${projectId}/env?teamId=${TEAM_ID}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ key, value, type: 'encrypted', target: ['production', 'preview', 'development'] }),
  });
  if (!res.ok) throw new Error(`create env ${key} failed: ${res.status} ${await res.text()}`);
}

for (const c of CUSTOMERS) {
  console.log(`\n=== ${c.code} (${c.vercelProject}) ===`);

  const primaryUrl = envVal(`FCS1_${c.code}_DATABASE_URL_UNPOOLED`);
  const secondaryPooled = envVal(`FCS1_${c.code}2_DATABASE_URL`);
  const secondaryUnpooled = envVal(`FCS1_${c.code}2_DATABASE_URL_UNPOOLED`);

  // Step 1: read the primary org's real code/name/timezone (not quota-blocked).
  let orgRows = [];
  try {
    const primaryClient = new Client({ connectionString: primaryUrl, ssl: { rejectUnauthorized: false } });
    await primaryClient.connect();
    const res = await primaryClient.query('SELECT organization_code, organization_name, timezone FROM public.organizations');
    orgRows = res.rows;
    await primaryClient.end();
  } catch (err) {
    console.log(`  Could not read primary org row (${err.message}) — will seed with a placeholder org.`);
  }
  const org = orgRows[0] ?? { organization_code: c.code.toLowerCase(), organization_name: c.code, timezone: 'UTC' };
  console.log(`  Primary org: ${JSON.stringify(org)}`);

  // Step 2: provision the secondary DB's schema.
  const secClient = new Client({ connectionString: secondaryUnpooled, ssl: { rejectUnauthorized: false } });
  try {
    await secClient.connect();
    process.stdout.write('  -- resetting public schema ... ');
    await secClient.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
    console.log('OK');

    process.stdout.write('  -- sql/schema.sql ... ');
    const schemaSql = readFileSync('sql/schema.sql', 'utf8');
    await secClient.query(schemaSql);
    console.log('OK');

    process.stdout.write('  -- migrations/014_upload_jobs_hotel_identity.sql ... ');
    const migSql = readFileSync('sql/migrations/014_upload_jobs_hotel_identity.sql', 'utf8');
    await secClient.query(migSql);
    console.log('OK');

    process.stdout.write(`  -- seeding organization (${org.organization_code}) ... `);
    await secClient.query(
      `insert into public.organizations (organization_code, organization_name, timezone)
       values ($1, $2, $3)
       on conflict (organization_code) do update
       set organization_name = excluded.organization_name, timezone = excluded.timezone`,
      [org.organization_code, org.organization_name, org.timezone]
    );
    console.log('OK');
  } catch (err) {
    console.log(`  Schema provisioning FAILED: ${err.message}`);
  } finally {
    await secClient.end();
  }

  // Step 3: wire the 3 env vars onto the live Vercel project (All Environments).
  try {
    const existing = await listEnvs(c.projectId);
    const KEYS = ['DATABASE_URL_SECONDARY', 'DATABASE_URL_UNPOOLED_SECONDARY', 'NEON_DB_SLOT'];
    for (const key of KEYS) {
      for (const m of existing.filter((e) => e.key === key)) {
        process.stdout.write(`  -- deleting existing ${key} (target=${(m.target || []).join(',')}) ... `);
        await deleteEnv(c.projectId, m.id);
        console.log('OK');
      }
    }
    const values = {
      DATABASE_URL_SECONDARY: secondaryPooled,
      DATABASE_URL_UNPOOLED_SECONDARY: secondaryUnpooled,
      NEON_DB_SLOT: 'primary',
    };
    for (const [key, value] of Object.entries(values)) {
      process.stdout.write(`  -- creating ${key} (All Environments) ... `);
      await createEnv(c.projectId, key, value);
      console.log('OK');
    }
  } catch (err) {
    console.log(`  Vercel env wiring FAILED: ${err.message}`);
  }
}

console.log('\nAll customers processed.');
