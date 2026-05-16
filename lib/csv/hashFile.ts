/**
 * Browser-side SHA-256 file hashing using the Web Crypto API.
 * Returns a lowercase hex digest string.
 *
 * This is client-only — never import from a Server Component or API route.
 */

export async function hashFile(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
