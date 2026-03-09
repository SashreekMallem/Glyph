import { createPrivateKey, createPublicKey, createSign, createVerify, constants, type KeyObject } from 'node:crypto';

import { CryptoConfigError, SignatureError } from './errors.js';

const HASH = 'sha256';
const PSS_SALT = 32; // Equal to the SHA-256 digest length.

let cachedPrivateKey: KeyObject | null = null;
let cachedPrivateSource: string | null = null;
let cachedPublicKey: KeyObject | null = null;
let cachedPublicSource: string | null = null;

function getPrivateKey(): KeyObject {
  const raw = process.env.SIGNING_PRIVATE_KEY;
  if (raw === undefined || raw.length === 0) {
    throw new CryptoConfigError(
      'SIGNING_PRIVATE_KEY is not set. Provide a PEM-encoded RSA private key.',
    );
  }
  if (cachedPrivateKey !== null && cachedPrivateSource === raw) {
    return cachedPrivateKey;
  }
  let key: KeyObject;
  try {
    key = createPrivateKey({ key: raw, format: 'pem' });
  } catch {
    throw new CryptoConfigError('SIGNING_PRIVATE_KEY could not be parsed as PEM.');
  }
  if (key.asymmetricKeyType !== 'rsa') {
    throw new CryptoConfigError(
      `SIGNING_PRIVATE_KEY must be an RSA key; got ${String(key.asymmetricKeyType)}.`,
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
      'SIGNING_PUBLIC_KEY is not set. Provide a PEM-encoded RSA public key.',
    );
  }
  if (cachedPublicKey !== null && cachedPublicSource === raw) {
    return cachedPublicKey;
  }
  let key: KeyObject;
  try {
    key = createPublicKey({ key: raw, format: 'pem' });
  } catch {
    throw new CryptoConfigError('SIGNING_PUBLIC_KEY could not be parsed as PEM.');
  }
  if (key.asymmetricKeyType !== 'rsa') {
    throw new CryptoConfigError(
      `SIGNING_PUBLIC_KEY must be an RSA key; got ${String(key.asymmetricKeyType)}.`,
    );
  }
  cachedPublicKey = key;
  cachedPublicSource = raw;
  return key;
}

/**
 * Sign a base64-encoded ciphertext string with RSA-PSS / SHA-256.
 *
 * The signature is deterministic in length but not in value (PSS salt is
 * random). Returns base64 encoding of the raw signature bytes.
 */
export async function signPayload(encrypted: string): Promise<string> {
  if (typeof encrypted !== 'string' || encrypted.length === 0) {
    throw new SignatureError('signPayload requires a non-empty string.');
  }
  const key = getPrivateKey();
  const signer = createSign(HASH);
  signer.update(encrypted);
  signer.end();
  const sig = signer.sign({
    key,
    padding: constants.RSA_PKCS1_PSS_PADDING,
    saltLength: PSS_SALT,
  });
  return sig.toString('base64');
}

/**
 * Verify an RSA-PSS / SHA-256 signature produced by {@link signPayload}.
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
  const verifier = createVerify(HASH);
  verifier.update(encrypted);
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
