import {
  fingerprintFields,
  type FieldFingerprints,
  type FieldRegions,
} from '@glyph/crypto';

/**
 * Drift detector for self-healing document sync.
 *
 * Given the current source text + the regions the caller located in it,
 * and the fingerprints+regions embedded in the document's last signed
 * payload, classify each field path as unchanged / changed / added /
 * removed. The sync endpoint uses this to decide which paths (if any)
 * need a targeted re-extraction.
 */

export interface DriftReport {
  readonly unchanged: readonly string[];
  readonly changed: readonly string[];
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly hasDrift: boolean;
}

export interface DetectDriftArgs {
  readonly currentText: string;
  readonly currentRegions: FieldRegions;
  readonly embeddedFingerprints: FieldFingerprints;
  readonly embeddedRegions: FieldRegions;
}

export function detectDrift(args: DetectDriftArgs): DriftReport {
  const { currentText, currentRegions, embeddedFingerprints, embeddedRegions } =
    args;

  const currentFps = fingerprintFields(currentText, currentRegions);

  const unchanged: string[] = [];
  const changed: string[] = [];
  const added: string[] = [];
  const removed: string[] = [];

  const allPaths = new Set<string>([
    ...Object.keys(embeddedFingerprints),
    ...Object.keys(embeddedRegions),
    ...Object.keys(currentRegions),
  ]);

  for (const path of allPaths) {
    const inEmbedded = path in embeddedFingerprints;
    const inCurrent = path in currentFps;

    if (inEmbedded && inCurrent) {
      if (embeddedFingerprints[path] === currentFps[path]) {
        unchanged.push(path);
      } else {
        changed.push(path);
      }
    } else if (inCurrent) {
      added.push(path);
    } else if (inEmbedded) {
      removed.push(path);
    }
    // path in embeddedRegions only (no fingerprint, no current) — treat
    // as removed since we can no longer verify it.
    else {
      removed.push(path);
    }
  }

  return {
    unchanged,
    changed,
    added,
    removed,
    hasDrift: changed.length + added.length + removed.length > 0,
  };
}
