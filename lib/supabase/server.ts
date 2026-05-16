import { PgSupabaseCompat, getPool } from '@/lib/db/supabaseCompat';

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
