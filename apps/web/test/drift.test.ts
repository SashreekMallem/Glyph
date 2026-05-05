import { describe, it, expect } from 'vitest';
import { fingerprintFields } from '@glyph/crypto';
import { detectDrift } from '../src/server/drift';

const TEXT = 'John Smith works at Acme Corp';
//            01234567890123456789012345678
const REGIONS = {
  name: [0, 10] as const,
  company: [20, 29] as const,
};

describe('detectDrift', () => {
  it('all unchanged when current matches embedded', () => {
    const fps = fingerprintFields(TEXT, REGIONS);
    const r = detectDrift({
      currentText: TEXT,
      currentRegions: REGIONS,
      embeddedFingerprints: fps,
      embeddedRegions: REGIONS,
    });
    expect(r.hasDrift).toBe(false);
    expect(r.unchanged.sort()).toEqual(['company', 'name']);
    expect(r.changed).toEqual([]);
  });

  it('detects edited field', () => {
    const fps = fingerprintFields(TEXT, REGIONS);
    const edited = 'Jane Smith works at Acme Corp';
    const r = detectDrift({
      currentText: edited,
      currentRegions: REGIONS,
      embeddedFingerprints: fps,
      embeddedRegions: REGIONS,
    });
    expect(r.hasDrift).toBe(true);
    expect(r.changed).toEqual(['name']);
    expect(r.unchanged).toEqual(['company']);
  });

  it('reports added paths', () => {
    const fps = fingerprintFields(TEXT, { name: REGIONS.name });
    const r = detectDrift({
      currentText: TEXT,
      currentRegions: REGIONS,
      embeddedFingerprints: fps,
      embeddedRegions: { name: REGIONS.name },
    });
    expect(r.added).toEqual(['company']);
    expect(r.hasDrift).toBe(true);
  });

  it('reports removed paths', () => {
    const fps = fingerprintFields(TEXT, REGIONS);
    const r = detectDrift({
      currentText: TEXT,
      currentRegions: { name: REGIONS.name },
      embeddedFingerprints: fps,
      embeddedRegions: REGIONS,
    });
    expect(r.removed).toEqual(['company']);
    expect(r.hasDrift).toBe(true);
  });

  it('empty embedded → all current paths are added', () => {
    const r = detectDrift({
      currentText: TEXT,
      currentRegions: REGIONS,
      embeddedFingerprints: {},
      embeddedRegions: {},
    });
    expect(r.added.sort()).toEqual(['company', 'name']);
    expect(r.hasDrift).toBe(true);
  });

  it('empty current → all embedded paths are removed', () => {
    const fps = fingerprintFields(TEXT, REGIONS);
    const r = detectDrift({
      currentText: '',
      currentRegions: {},
      embeddedFingerprints: fps,
      embeddedRegions: REGIONS,
    });
    expect(r.removed.sort()).toEqual(['company', 'name']);
    expect(r.hasDrift).toBe(true);
  });
});
