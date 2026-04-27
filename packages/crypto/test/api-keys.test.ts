import { describe, expect, it } from 'vitest';

import { generateApiKey, verifyApiKey } from '../src/index.js';

describe('generateApiKey / verifyApiKey', () => {
  it('produces sk_live_ prefix and 72-char total length', () => {
    const k = generateApiKey();
    expect(k.raw.startsWith('sk_live_')).toBe(true);
    expect(k.raw.length).toBe(72);
  });

  it('prefix is 16 chars and stable (first 16 of raw)', () => {
    const k = generateApiKey();
    expect(k.prefix.length).toBe(16);
    expect(k.prefix).toBe(k.raw.slice(0, 16));
    expect(k.prefix.startsWith('sk_live_')).toBe(true);
  });

  it('produces 1000 unique raw keys and unique hashes', () => {
    const raws = new Set<string>();
    const hashes = new Set<string>();
    for (let i = 0; i < 1000; i += 1) {
      const k = generateApiKey();
      raws.add(k.raw);
      hashes.add(k.hash);
    }
    expect(raws.size).toBe(1000);
    expect(hashes.size).toBe(1000);
  });

  it('hash verifies against the correct raw', async () => {
    const k = generateApiKey();
    expect(await verifyApiKey(k.raw, k.hash)).toBe(true);
  });

  it('hash does not verify against a different raw', async () => {
    const a = generateApiKey();
    const b = generateApiKey();
    expect(await verifyApiKey(b.raw, a.hash)).toBe(false);
  });

  it('returns false for empty raw', async () => {
    const k = generateApiKey();
    expect(await verifyApiKey('', k.hash)).toBe(false);
  });

  it('returns false for empty hash', async () => {
    const k = generateApiKey();
    expect(await verifyApiKey(k.raw, '')).toBe(false);
  });

  it('returns false for non-string raw', async () => {
    const k = generateApiKey();
    expect(await verifyApiKey(1 as unknown as string, k.hash)).toBe(false);
  });

  it('returns false for non-string hash', async () => {
    const k = generateApiKey();
    expect(await verifyApiKey(k.raw, 1 as unknown as string)).toBe(false);
  });

  it('returns false for malformed hash (bcrypt throws internally)', async () => {
    expect(await verifyApiKey('sk_live_xxx', 'not-a-bcrypt-hash')).toBe(false);
  });
});
