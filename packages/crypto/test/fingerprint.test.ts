import { describe, it, expect, vi } from 'vitest';
import { fingerprintText, fingerprintFields } from '../src/fingerprint.js';

describe('fingerprintText', () => {
  it('is deterministic', () => {
    expect(fingerprintText('hello')).toBe(fingerprintText('hello'));
  });

  it('produces different hashes for different inputs', () => {
    expect(fingerprintText('hello')).not.toBe(fingerprintText('world'));
  });

  it('returns 16 hex chars', () => {
    expect(fingerprintText('anything')).toMatch(/^[0-9a-f]{16}$/);
  });

  it('normalizes whitespace runs to a single space', () => {
    expect(fingerprintText('a   b\n\nc')).toBe(fingerprintText('a b c'));
  });

  it('trims surrounding whitespace', () => {
    expect(fingerprintText('  hello  ')).toBe(fingerprintText('hello'));
  });

  it('treats NFC and NFD as equivalent', () => {
    const nfc = 'é'; // é
    const nfd = 'é';
    expect(fingerprintText(nfc)).toBe(fingerprintText(nfd));
  });
});

describe('fingerprintFields', () => {
  const text = 'John Smith works at Acme Corp';
  //            0123456789012345678901234567890
  //                      1111111111222222222

  it('fingerprints each region independently', () => {
    const regions = {
      name: [0, 10] as const,
      company: [20, 29] as const,
    };
    const fps = fingerprintFields(text, regions);
    expect(fps.name).toBe(fingerprintText('John Smith'));
    expect(fps.company).toBe(fingerprintText('Acme Corp'));
  });

  it('returns empty object for empty regions', () => {
    expect(fingerprintFields(text, {})).toEqual({});
  });

  it('skips out-of-bounds regions and warns', () => {
    const warn = vi.fn();
    const fps = fingerprintFields(text, {
      ok: [0, 4] as const,
      bad: [100, 200] as const,
      reversed: [10, 5] as const,
    }, { warn });
    expect(Object.keys(fps)).toEqual(['ok']);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('skips non-integer offsets', () => {
    const warn = vi.fn();
    const fps = fingerprintFields(text, {
      bad: [0.5, 4] as unknown as readonly [number, number],
    }, { warn });
    expect(fps).toEqual({});
    expect(warn).toHaveBeenCalledOnce();
  });
});
