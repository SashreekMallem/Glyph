import { createCipheriv, randomBytes } from 'node:crypto';

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  __resetMasterKeyCacheForTests,
  CryptoConfigError,
  DecryptionError,
  decryptPayload,
  encryptPayload,
} from '../src/index.js';
import { makeTestKeys } from './setup.js';

function encryptRaw(plaintext: Buffer, keyHex: string): {
  encrypted: string;
  iv: string;
  tag: string;
} {
  const key = Buffer.from(keyHex, 'hex');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    encrypted: ct.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  };
}

const keys = makeTestKeys();

beforeAll(() => {
  process.env.ENCRYPTION_MASTER_KEY = keys.masterKeyHex;
});

beforeEach(() => {
  process.env.ENCRYPTION_MASTER_KEY = keys.masterKeyHex;
  __resetMasterKeyCacheForTests();
});

describe('encryptPayload / decryptPayload', () => {
  it('roundtrips complex JSON', async () => {
    const data = {
      foo: 'bar',
      n: 42,
      nested: { arr: [1, 2, { k: 'v' }], b: true, nil: null },
      unicode: 'héllo 🔐',
    };
    const enc = await encryptPayload(data);
    const dec = await decryptPayload(enc.encrypted, enc.iv, enc.tag);
    expect(dec).toEqual(data);
  });

  it('produces unique IVs across 100 calls', async () => {
    const ivs = new Set<string>();
    for (let i = 0; i < 100; i += 1) {
      const { iv } = await encryptPayload({ i });
      ivs.add(iv);
    }
    expect(ivs.size).toBe(100);
  });

  it('uses memoized key on repeated calls (same env value)', async () => {
    // Second call returns the cached key — exercise the short-circuit branch.
    const a = await encryptPayload({ x: 1 });
    const b = await encryptPayload({ x: 2 });
    expect(a.iv).not.toBe(b.iv);
  });

  it('throws DecryptionError when ciphertext is tampered', async () => {
    const enc = await encryptPayload({ hello: 'world' });
    const tampered = Buffer.from(enc.encrypted, 'base64');
    tampered[0] = (tampered[0] ?? 0) ^ 0xff;
    await expect(
      decryptPayload(tampered.toString('base64'), enc.iv, enc.tag),
    ).rejects.toBeInstanceOf(DecryptionError);
  });

  it('throws DecryptionError when tag is tampered', async () => {
    const enc = await encryptPayload({ hello: 'world' });
    const tag = Buffer.from(enc.tag, 'base64');
    tag[0] = (tag[0] ?? 0) ^ 0xff;
    await expect(
      decryptPayload(enc.encrypted, enc.iv, tag.toString('base64')),
    ).rejects.toBeInstanceOf(DecryptionError);
  });

  it('throws DecryptionError when IV is tampered', async () => {
    const enc = await encryptPayload({ hello: 'world' });
    const iv = Buffer.from(enc.iv, 'base64');
    iv[0] = (iv[0] ?? 0) ^ 0xff;
    await expect(
      decryptPayload(enc.encrypted, iv.toString('base64'), enc.tag),
    ).rejects.toBeInstanceOf(DecryptionError);
  });

  it('throws DecryptionError for malformed base64 in encrypted', async () => {
    const enc = await encryptPayload({ hello: 'world' });
    await expect(decryptPayload('not*base64!', enc.iv, enc.tag)).rejects.toBeInstanceOf(
      DecryptionError,
    );
  });

  it('throws DecryptionError for malformed base64 in iv', async () => {
    const enc = await encryptPayload({ hello: 'world' });
    await expect(decryptPayload(enc.encrypted, '!!!', enc.tag)).rejects.toBeInstanceOf(
      DecryptionError,
    );
  });

  it('throws DecryptionError for malformed base64 in tag', async () => {
    const enc = await encryptPayload({ hello: 'world' });
    await expect(decryptPayload(enc.encrypted, enc.iv, '***')).rejects.toBeInstanceOf(
      DecryptionError,
    );
  });

  it('throws DecryptionError for empty field', async () => {
    const enc = await encryptPayload({ a: 1 });
    await expect(decryptPayload('', enc.iv, enc.tag)).rejects.toThrow(DecryptionError);
  });

  it('throws DecryptionError for non-string field', async () => {
    const enc = await encryptPayload({ a: 1 });
    await expect(
      decryptPayload(42 as unknown as string, enc.iv, enc.tag),
    ).rejects.toThrow(DecryptionError);
  });

  it('throws DecryptionError for wrong-length iv', async () => {
    const enc = await encryptPayload({ a: 1 });
    const shortIv = Buffer.alloc(8, 1).toString('base64');
    await expect(decryptPayload(enc.encrypted, shortIv, enc.tag)).rejects.toThrow(
      /iv must decode/,
    );
  });

  it('throws DecryptionError for wrong-length tag', async () => {
    const enc = await encryptPayload({ a: 1 });
    const shortTag = Buffer.alloc(8, 1).toString('base64');
    await expect(decryptPayload(enc.encrypted, enc.iv, shortTag)).rejects.toThrow(
      /tag must decode/,
    );
  });

  it('throws DecryptionError for base64 that round-trips differently (truncated)', async () => {
    // A single stray non-padding char would be caught by regex, but base64
    // that silently loses data needs the round-trip check.
    const enc = await encryptPayload({ a: 1 });
    // Inject valid charset but wrong padding so round-trip differs.
    const broken = `${enc.encrypted.slice(0, -1)}A`;
    const result = await decryptPayload(broken, enc.iv, enc.tag).catch((e) => e);
    expect(result).toBeInstanceOf(DecryptionError);
  });

  it('throws DecryptionError when base64 regex-passes but decodes differently ("A==")', async () => {
    const enc = await encryptPayload({ a: 1 });
    await expect(decryptPayload('A==', enc.iv, enc.tag)).rejects.toBeInstanceOf(
      DecryptionError,
    );
  });

  it('throws DecryptionError when plaintext is not valid JSON', async () => {
    const crafted = encryptRaw(Buffer.from('not json at all'), keys.masterKeyHex);
    await expect(
      decryptPayload(crafted.encrypted, crafted.iv, crafted.tag),
    ).rejects.toThrow(/not valid JSON/);
  });

  it('throws DecryptionError when plaintext is JSON but not an object', async () => {
    const crafted = encryptRaw(Buffer.from('42'), keys.masterKeyHex);
    await expect(
      decryptPayload(crafted.encrypted, crafted.iv, crafted.tag),
    ).rejects.toThrow(/not a JSON object/);
  });

  it('throws DecryptionError when plaintext is JSON null', async () => {
    const crafted = encryptRaw(Buffer.from('null'), keys.masterKeyHex);
    await expect(
      decryptPayload(crafted.encrypted, crafted.iv, crafted.tag),
    ).rejects.toThrow(/not a JSON object/);
  });

  it('throws CryptoConfigError when env var is missing', async () => {
    delete process.env.ENCRYPTION_MASTER_KEY;
    __resetMasterKeyCacheForTests();
    await expect(encryptPayload({ a: 1 })).rejects.toBeInstanceOf(CryptoConfigError);
  });

  it('throws CryptoConfigError when env var is empty', async () => {
    process.env.ENCRYPTION_MASTER_KEY = '';
    __resetMasterKeyCacheForTests();
    await expect(encryptPayload({ a: 1 })).rejects.toBeInstanceOf(CryptoConfigError);
  });

  it('throws CryptoConfigError when env var is wrong length', async () => {
    process.env.ENCRYPTION_MASTER_KEY = 'abcd';
    __resetMasterKeyCacheForTests();
    await expect(encryptPayload({ a: 1 })).rejects.toThrow(/64 hex chars/);
  });

  it('throws CryptoConfigError when env var is not hex', async () => {
    process.env.ENCRYPTION_MASTER_KEY = 'z'.repeat(64);
    __resetMasterKeyCacheForTests();
    await expect(encryptPayload({ a: 1 })).rejects.toThrow(/hex-encoded/);
  });
});
