import {
  createPrivateKey,
  createPublicKey,
  createSign,
  createVerify,
  constants,
  sign as edSign,
  verify as edVerify,
  type KeyObject,
} from 'node:crypto';

import { CryptoConfigError, SignatureError } from './errors.js';

/**
 * Glyph payload signing — supports BOTH RSA-PSS / SHA-256 and Ed25519.
 *
 * Algorithm is auto-detected from the key's `asymmetricKeyType`:
 *   - `'rsa'`     → RSA-PSS / SHA-256 (legacy, longer signatures)
 *   - `'ed25519'` → Ed25519 (modern, 64-byte deterministic signatures)
 *
 * Ed25519 is the preferred algorithm for new deployments: smaller
 * signatures, faster, no padding parameters to misconfigure.
 */

const HASH = 'sha256';
const PSS_SALT = 32; // Equal to the SHA-256 digest length.

let cachedPrivateKey: KeyObject | null = null;
let cachedPrivateSource: string | null = null;
let cachedPublicKey: KeyObject | null = null;
let cachedPublicSource: string | null = null;

function tryDecodeBase64Pem(raw: string): string {
  // Some deployments base64-encode the PEM in env vars to avoid newline
  // mangling. Detect: a non-PEM input that decodes to a string starting
  // with "-----BEGIN".
  if (raw.includes('BEGIN')) return raw;
  try {
    const decoded = Buffer.from(raw, 'base64').toString('utf8');
    if (decoded.includes('BEGIN')) return decoded;
  } catch {
    // fall through
  }
  return raw;
}

function getPrivateKey(): KeyObject {
  const raw = process.env.SIGNING_PRIVATE_KEY;
  if (raw === undefined || raw.length === 0) {
    throw new CryptoConfigError(
      'SIGNING_PRIVATE_KEY is not set. Provide a PEM-encoded RSA or Ed25519 private key.',
    );
  }
  if (cachedPrivateKey !== null && cachedPrivateSource === raw) {
    return cachedPrivateKey;
  }
  const pem = tryDecodeBase64Pem(raw);
  let key: KeyObject;
  try {
    key = createPrivateKey({ key: pem, format: 'pem' });
  } catch {
    throw new CryptoConfigError('SIGNING_PRIVATE_KEY could not be parsed as PEM.');
  }
  if (key.asymmetricKeyType !== 'rsa' && key.asymmetricKeyType !== 'ed25519') {
    throw new CryptoConfigError(
      `SIGNING_PRIVATE_KEY must be an RSA or Ed25519 key; got ${String(key.asymmetricKeyType)}.`,
    );
  }
  cachedPrivateKey = key;
  cachedPrivateSource = raw;
  return key;
}

function getPublicKey(): KeyObject {
  const raw = process.env.SIGNING_PUBLIC_KEY;
  if (raw === undefined || raw.length === 0) {
    throw new CryptoConfigError(
      'SIGNING_PUBLIC_KEY is not set. Provide a PEM-encoded RSA or Ed25519 public key.',
    );
  }
  if (cachedPublicKey !== null && cachedPublicSource === raw) {
    return cachedPublicKey;
  }
  const pem = tryDecodeBase64Pem(raw);
  let key: KeyObject;
  try {
    key = createPublicKey({ key: pem, format: 'pem' });
  } catch {
    throw new CryptoConfigError('SIGNING_PUBLIC_KEY could not be parsed as PEM.');
  }
  if (key.asymmetricKeyType !== 'rsa' && key.asymmetricKeyType !== 'ed25519') {
    throw new CryptoConfigError(
      `SIGNING_PUBLIC_KEY must be an RSA or Ed25519 key; got ${String(key.asymmetricKeyType)}.`,
    );
  }
  cachedPublicKey = key;
  cachedPublicSource = raw;
  return key;
}

/**
 * Sign a UTF-8 string. Returns base64 of the raw signature bytes.
 *
 * For RSA the result is RSA-PSS / SHA-256 with a 32-byte random salt
 * (signature length = key size in bytes; non-deterministic).
 * For Ed25519 the result is the deterministic 64-byte EdDSA signature.
 */
export async function signPayload(encrypted: string): Promise<string> {
  if (typeof encrypted !== 'string' || encrypted.length === 0) {
    throw new SignatureError('signPayload requires a non-empty string.');
  }
  const key = getPrivateKey();
  const data = Buffer.from(encrypted, 'utf8');

  if (key.asymmetricKeyType === 'ed25519') {
    // Node's `sign(null, data, key)` runs the EdDSA pure-mode signer.
    const sig = edSign(null, data, key);
    return sig.toString('base64');
  }

  // RSA-PSS / SHA-256
  const signer = createSign(HASH);
  signer.update(data);
  signer.end();
  const sig = signer.sign({
    key,
    padding: constants.RSA_PKCS1_PSS_PADDING,
    saltLength: PSS_SALT,
  });
  return sig.toString('base64');
}

/**
 * Verify a signature produced by {@link signPayload}.
 *
 * Returns `false` (rather than throwing) when the signature fails to
 * verify, is malformed, or does not match. Throws only when config is
 * missing/invalid.
 */
export async function verifySignature(
  encrypted: string,
  signature: string,
): Promise<boolean> {
  const key = getPublicKey();
  if (typeof encrypted !== 'string' || typeof signature !== 'string') {
    return false;
  }
  if (encrypted.length === 0 || signature.length === 0) {
    return false;
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(signature)) {
    return false;
  }
  const sigBuf = Buffer.from(signature, 'base64');
  if (sigBuf.length === 0) {
    return false;
  }
  const data = Buffer.from(encrypted, 'utf8');

  if (key.asymmetricKeyType === 'ed25519') {
    try {
      return edVerify(null, data, key, sigBuf);
    } catch {
      return false;
    }
  }

  // RSA-PSS / SHA-256
  const verifier = createVerify(HASH);
  verifier.update(data);
  verifier.end();
  return verifier.verify(
    { key, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: PSS_SALT },
    sigBuf,
  );
}

/** @internal test hook — clears memoized signing keys. */
export function __resetSigningKeyCacheForTests(): void {
  cachedPrivateKey = null;
  cachedPrivateSource = null;
  cachedPublicKey = null;
  cachedPublicSource = null;
}
