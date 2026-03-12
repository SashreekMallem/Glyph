import { randomBytes } from 'node:crypto';

import bcrypt from 'bcryptjs';

const BCRYPT_ROUNDS = 12;
const RAW_RANDOM_BYTES = 32; // → 64 hex chars
const PREFIX = 'sk_live_';
const PREFIX_LOOKUP_LENGTH = PREFIX.length + 8; // 8 → 16 total

export interface GeneratedApiKey {
  readonly raw: string;
  readonly hash: string;
  readonly prefix: string;
}

/**
 * Generate a new API key.
 *
 * - `raw` is the full secret returned to the caller exactly once
 *   (`sk_live_` + 64 random hex chars → 72 chars total).
 * - `hash` is the bcrypt(12) hash of `raw`, stored server-side.
 * - `prefix` is the first 16 chars of `raw` — safe to store plaintext
 *   and use as an indexed lookup column so verification does not have
 *   to scan every row.
 */
export function generateApiKey(): GeneratedApiKey {
  const random = randomBytes(RAW_RANDOM_BYTES).toString('hex');
  const raw = `${PREFIX}${random}`;
  const hash = bcrypt.hashSync(raw, BCRYPT_ROUNDS);
  const prefix = raw.slice(0, PREFIX_LOOKUP_LENGTH);
  return { raw, hash, prefix };
}

/**
 * Verify a raw API key against its bcrypt hash.
 *
 * Returns `false` for any malformed input rather than throwing so that
 * it can be used as the first gate in an auth middleware without extra
 * try/catch wrappers.
 */
export async function verifyApiKey(
  raw: string,
  hash: string,
): Promise<boolean> {
  if (typeof raw !== 'string' || typeof hash !== 'string') {
    return false;
  }
  if (raw.length === 0 || hash.length === 0) {
    return false;
  }
  return bcrypt.compare(raw, hash);
}
