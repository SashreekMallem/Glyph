import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  __resetSigningKeyCacheForTests,
  CryptoConfigError,
  SignatureError,
  signPayload,
  verifySignature,
} from '../src/index.js';
import { makeTestKeys } from './setup.js';

const keys = makeTestKeys();

beforeAll(() => {
  process.env.SIGNING_PRIVATE_KEY = keys.privatePem;
  process.env.SIGNING_PUBLIC_KEY = keys.publicPem;
});

beforeEach(() => {
  process.env.SIGNING_PRIVATE_KEY = keys.privatePem;
  process.env.SIGNING_PUBLIC_KEY = keys.publicPem;
  __resetSigningKeyCacheForTests();
});

describe('signPayload / verifySignature', () => {
  it('round-trips a signature', async () => {
    const sig = await signPayload('hello-base64-payload');
    expect(await verifySignature('hello-base64-payload', sig)).toBe(true);
  });

  it('uses cached keys on second call (same env)', async () => {
    const a = await signPayload('one');
    const b = await signPayload('two');
    expect(await verifySignature('one', a)).toBe(true);
    expect(await verifySignature('two', b)).toBe(true);
  });

  it('returns false if ciphertext is tampered', async () => {
    const sig = await signPayload('abc');
    expect(await verifySignature('abd', sig)).toBe(false);
  });

  it('returns false if signature is tampered', async () => {
    const sig = await signPayload('abc');
    const buf = Buffer.from(sig, 'base64');
    buf[0] = (buf[0] ?? 0) ^ 0xff;
    expect(await verifySignature('abc', buf.toString('base64'))).toBe(false);
  });

  it('returns false with a different public key', async () => {
    const sig = await signPayload('abc');
    process.env.SIGNING_PUBLIC_KEY = keys.otherPublicPem;
    __resetSigningKeyCacheForTests();
    expect(await verifySignature('abc', sig)).toBe(false);
  });

  it('returns false for empty inputs', async () => {
    expect(await verifySignature('', 'x')).toBe(false);
    expect(await verifySignature('x', '')).toBe(false);
  });

  it('returns false for non-string inputs', async () => {
    expect(await verifySignature(1 as unknown as string, 'x')).toBe(false);
    expect(await verifySignature('x', 1 as unknown as string)).toBe(false);
  });

  it('returns false for malformed base64 signature', async () => {
    expect(await verifySignature('abc', '***')).toBe(false);
  });

  it('returns false for empty-decoded signature ("A==")', async () => {
    // "A==" matches regex but decodes to 0 bytes.
    expect(await verifySignature('abc', 'A==')).toBe(false);
  });

  it('throws SignatureError when signing empty input', async () => {
    await expect(signPayload('')).rejects.toBeInstanceOf(SignatureError);
  });

  it('throws SignatureError when signing non-string input', async () => {
    await expect(signPayload(1 as unknown as string)).rejects.toBeInstanceOf(
      SignatureError,
    );
  });

  it('throws CryptoConfigError when private key env is missing', async () => {
    delete process.env.SIGNING_PRIVATE_KEY;
    __resetSigningKeyCacheForTests();
    await expect(signPayload('x')).rejects.toBeInstanceOf(CryptoConfigError);
  });

  it('throws CryptoConfigError when private key env is empty', async () => {
    process.env.SIGNING_PRIVATE_KEY = '';
    __resetSigningKeyCacheForTests();
    await expect(signPayload('x')).rejects.toBeInstanceOf(CryptoConfigError);
  });

  it('throws CryptoConfigError when public key env is missing', async () => {
    delete process.env.SIGNING_PUBLIC_KEY;
    __resetSigningKeyCacheForTests();
    await expect(verifySignature('x', 'y')).rejects.toBeInstanceOf(CryptoConfigError);
  });

  it('throws CryptoConfigError when public key env is empty', async () => {
    process.env.SIGNING_PUBLIC_KEY = '';
    __resetSigningKeyCacheForTests();
    await expect(verifySignature('x', 'y')).rejects.toBeInstanceOf(CryptoConfigError);
  });

  it('throws CryptoConfigError for malformed private PEM', async () => {
    process.env.SIGNING_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\nnope\n-----END PRIVATE KEY-----\n';
    __resetSigningKeyCacheForTests();
    await expect(signPayload('x')).rejects.toBeInstanceOf(CryptoConfigError);
  });

  it('throws CryptoConfigError for malformed public PEM', async () => {
    process.env.SIGNING_PUBLIC_KEY = '-----BEGIN PUBLIC KEY-----\nnope\n-----END PUBLIC KEY-----\n';
    __resetSigningKeyCacheForTests();
    await expect(verifySignature('x', 'y')).rejects.toBeInstanceOf(CryptoConfigError);
  });

  it('throws CryptoConfigError when private key is not RSA', async () => {
    const { generateKeyPairSync } = await import('node:crypto');
    const ed = generateKeyPairSync('ed25519', {
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    process.env.SIGNING_PRIVATE_KEY = ed.privateKey;
    __resetSigningKeyCacheForTests();
    await expect(signPayload('x')).rejects.toThrow(/RSA/);
  });

  it('throws CryptoConfigError when public key is not RSA', async () => {
    const { generateKeyPairSync } = await import('node:crypto');
    const ed = generateKeyPairSync('ed25519', {
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    process.env.SIGNING_PUBLIC_KEY = ed.publicKey;
    __resetSigningKeyCacheForTests();
    await expect(verifySignature('x', 'y')).rejects.toThrow(/RSA/);
  });
});
