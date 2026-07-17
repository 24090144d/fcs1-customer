import { PgSupabaseCompat, getPool, getPoolByConnectionString, resolveDatabaseUrl } from '@/lib/db/supabaseCompat';

export async function createClient() {
  // Neon migration note: this now returns the same server-side DB client as createAdminClient.
  return new PgSupabaseCompat(getPool());
}

export function createAdminClient() {
  if (typeof window !== 'undefined') {
    throw new Error('createAdminClient() must never run in the browser.');
  }
  return new PgSupabaseCompat(getPool());
}

export function createAiAdminClient() {
  if (typeof window !== 'undefined') {
    throw new Error('createAiAdminClient() must never run in the browser.');
  }
  // Follows the same NEON_DB_SLOT (primary/secondary) as getPool() — AI_DATABASE_URL
  // (and its _SECONDARY counterpart) take priority when set, else fall back to the
  // main DATABASE_URL slot so AI features stay on whichever Neon project is active.
  const slot = (process.env.NEON_DB_SLOT || 'primary').trim().toLowerCase();
  const aiUrl = slot === 'secondary'
    ? (process.env.AI_DATABASE_URL_SECONDARY || process.env.AI_DATABASE_URL)
    : process.env.AI_DATABASE_URL;
  const connectionString = aiUrl || resolveDatabaseUrl(true);
  if (!connectionString) {
    throw new Error('AI_DATABASE_URL or DATABASE_URL is not set.');
  }
  return new PgSupabaseCompat(getPoolByConnectionString(connectionString));
}
