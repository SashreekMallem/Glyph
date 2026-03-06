import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { CryptoConfigError, DecryptionError } from './errors.js';

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const HEX_KEY_LENGTH = KEY_BYTES * 2;

let cachedKey: Buffer | null = null;
let cachedKeySource: string | null = null;

/**
 * Resolve the AES-256 master key from `process.env.ENCRYPTION_MASTER_KEY`.
 *
 * Memoized per-process, but re-reads if the env var changes (this keeps
 * tests that swap keys inexpensive while avoiding repeated hex decoding
 * in production).
 */
function getMasterKey(): Buffer {
  const raw = process.env.ENCRYPTION_MASTER_KEY;
  if (raw === undefined || raw.length === 0) {
    throw new CryptoConfigError(
      'ENCRYPTION_MASTER_KEY is not set. Provide a 32-byte hex-encoded key (64 hex chars).',
    );
  }
  if (cachedKey !== null && cachedKeySource === raw) {
    return cachedKey;
  }
  if (raw.length !== HEX_KEY_LENGTH) {
    throw new CryptoConfigError(
      `ENCRYPTION_MASTER_KEY must be ${HEX_KEY_LENGTH} hex chars (32 bytes); received ${raw.length}.`,
    );
  }
  if (!/^[0-9a-fA-F]+$/.test(raw)) {
    throw new CryptoConfigError(
      'ENCRYPTION_MASTER_KEY must be hex-encoded (0-9, a-f).',
    );
  }
  // Length and charset already validated above, so hex decoding always
  // produces exactly KEY_BYTES bytes.
  const key = Buffer.from(raw, 'hex');
  cachedKey = key;
  cachedKeySource = raw;
  return key;
}

export interface EncryptedPayload {
  readonly encrypted: string;
  readonly iv: string;
  readonly tag: string;
}

/**
 * Encrypt a JSON-serializable object with AES-256-GCM.
 *
 * A fresh random 96-bit IV is generated per call (never reuse an IV under
 * the same key with GCM). Returns base64-encoded ciphertext, IV and auth
 * tag suitable for embedding in a document or transport envelope.
 */
export async function encryptPayload(
  data: object,
): Promise<EncryptedPayload> {
  const key = getMasterKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const plaintext = Buffer.from(JSON.stringify(data), 'utf8');
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    encrypted: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
  };
}

function decodeBase64Strict(value: string, field: string): Buffer {
  if (typeof value !== 'string' || value.length === 0) {
    throw new DecryptionError(`${field} is empty or not a string.`);
  }
  // Node's Buffer.from(..., 'base64') is permissive; enforce strict base64
  // to reject tampering that merely rearranges padding.
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new DecryptionError(`${field} is not valid base64.`);
  }
  const buf = Buffer.from(value, 'base64');
  // Round-trip to detect silent truncation.
  if (buf.toString('base64').replace(/=+$/, '') !== value.replace(/=+$/, '')) {
    throw new DecryptionError(`${field} is not valid base64.`);
  }
  return buf;
}

/**
 * Decrypt a payload produced by {@link encryptPayload}.
 *
 * Verifies the GCM auth tag. Any tampering to ciphertext, IV, or tag, as
 * well as use of the wrong key, causes a {@link DecryptionError}.
 */
export async function decryptPayload(
  encrypted: string,
  iv: string,
  tag: string,
): Promise<object> {
  const key = getMasterKey();
  const ivBuf = decodeBase64Strict(iv, 'iv');
  const tagBuf = decodeBase64Strict(tag, 'tag');
  const ctBuf = decodeBase64Strict(encrypted, 'encrypted');

  if (ivBuf.length !== IV_BYTES) {
    throw new DecryptionError(`iv must decode to ${IV_BYTES} bytes.`);
  }
  if (tagBuf.length !== TAG_BYTES) {
    throw new DecryptionError(`tag must decode to ${TAG_BYTES} bytes.`);
  }

  const decipher = createDecipheriv(ALGORITHM, key, ivBuf);
  decipher.setAuthTag(tagBuf);

  let plaintext: Buffer;
  try {
    plaintext = Buffer.concat([decipher.update(ctBuf), decipher.final()]);
  } catch {
    throw new DecryptionError('Authentication failed; payload is corrupted or was tampered with.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext.toString('utf8'));
  } catch {
    throw new DecryptionError('Decrypted payload is not valid JSON.');
  }
  if (parsed === null || typeof parsed !== 'object') {
    throw new DecryptionError('Decrypted payload is not a JSON object.');
  }
  return parsed;
}

/** @internal test hook — clears the memoized master key. */
export function __resetMasterKeyCacheForTests(): void {
  cachedKey = null;
  cachedKeySource = null;
}
