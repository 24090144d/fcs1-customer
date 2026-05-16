import { PgSupabaseCompat, getPool, getPoolByConnectionString } from '@/lib/db/supabaseCompat';

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
  const connectionString = process.env.AI_DATABASE_URL || process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('AI_DATABASE_URL or DATABASE_URL is not set.');
  }
  return new PgSupabaseCompat(getPoolByConnectionString(connectionString));
}
