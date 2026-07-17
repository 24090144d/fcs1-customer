// One-off: consolidates fcs1-mo's DATABASE_URL_SECONDARY / DATABASE_URL_UNPOOLED_SECONDARY
// / NEON_DB_SLOT env vars onto a single "All Environments" (production+preview+development)
// entry each, refreshed from .env.neon's FCS1_MO2_* values. Uses the Vercel REST API
// directly (reading the CLI's own stored auth token) because `vercel env add <name> preview`
// hits a CLI bug where it loops back to the same "action_required: git_branch_required"
// hint even when re-run with its own suggested "all Preview branches" command.
//
// Usage: node scripts/set_mo_secondary_env_all_envs.mjs

import { readFileSync } from 'fs';

const authPath = 'C:/Users/William.Choo/AppData/Roaming/xdg.data/com.vercel.cli/auth.json';
const { token } = JSON.parse(readFileSync(authPath, 'utf8'));

const projectPath = 'C:/Users/William.Choo/AppData/Local/Temp/vercel-fcs1-mo/.vercel/project.json';
const { projectId, orgId } = JSON.parse(readFileSync(projectPath, 'utf8'));

const envText = readFileSync('.env.neon', 'utf8');
function envVal(name) {
  const m = envText.match(new RegExp(`^${name}=(.+)$`, 'm'));
  if (!m) throw new Error(`${name} not found in .env.neon`);
  return m[1].trim().replace(/^"(.*)"$/, '$1');
}

const VALUES = {
  DATABASE_URL_SECONDARY: envVal('FCS1_MO2_DATABASE_URL'),
  DATABASE_URL_UNPOOLED_SECONDARY: envVal('FCS1_MO2_DATABASE_URL_UNPOOLED'),
  NEON_DB_SLOT: 'secondary',
};

const API = 'https://api.vercel.com';
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

async function listEnvs() {
  const res = await fetch(`${API}/v10/projects/${projectId}/env?teamId=${orgId}`, { headers });
  if (!res.ok) throw new Error(`list envs failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.envs ?? [];
}

async function deleteEnv(id) {
  const res = await fetch(`${API}/v9/projects/${projectId}/env/${id}?teamId=${orgId}`, {
    method: 'DELETE',
    headers,
  });
  if (!res.ok) throw new Error(`delete env ${id} failed: ${res.status} ${await res.text()}`);
}

async function createEnv(key, value) {
  const res = await fetch(`${API}/v10/projects/${projectId}/env?teamId=${orgId}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      key,
      value,
      type: 'encrypted',
      target: ['production', 'preview', 'development'],
    }),
  });
  if (!res.ok) throw new Error(`create env ${key} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

const existing = await listEnvs();

for (const key of Object.keys(VALUES)) {
  const matches = existing.filter((e) => e.key === key);
  for (const m of matches) {
    process.stdout.write(`-- deleting existing ${key} (target=${(m.target || []).join(',')}) ... `);
    await deleteEnv(m.id);
    console.log('OK');
  }
}

for (const [key, value] of Object.entries(VALUES)) {
  process.stdout.write(`-- creating ${key} (All Environments) ... `);
  await createEnv(key, value);
  console.log('OK');
}

console.log('\nDone. Run `vercel env ls production --cwd /tmp/vercel-fcs1-mo` (or preview/development) to confirm.');
