import { createHash } from 'node:crypto';

/**
 * Field-level fingerprinting for self-healing document sync.
 *
 * The Glyph payload embeds a `regions` map (path → [start, end] byte
 * offsets in the source text) and a `fingerprints` map (path → 16-char
 * hex digest of the normalized text at that region). On re-read we
 * recompute fingerprints from the *current* source text and diff them
 * against the embedded set: paths whose hash matches are still trusted
 * (free), paths that differ are re-extracted with a targeted prompt.
 *
 * Normalization (must match across read/write surfaces):
 *   - Unicode NFC
 *   - trim leading/trailing whitespace
 *   - collapse runs of any whitespace to a single space
 *
 * Hash truncation to 16 hex chars (64 bits) is plenty for drift
 * detection — we're not building a Merkle tree, just an integrity
 * tripwire per field. Collisions at this width require ~2^32 attempts.
 */

export type FieldRegions = Record<string, readonly [number, number]>;
export type FieldFingerprints = Record<string, string>;

export interface FingerprintDeps {
  readonly warn?: (msg: string) => void;
}

function normalize(text: string): string {
  return text.normalize('NFC').trim().replace(/\s+/g, ' ');
}

export function fingerprintText(text: string): string {
  return createHash('sha256').update(normalize(text), 'utf8').digest('hex').slice(0, 16);
}

export function fingerprintFields(
  text: string,
  regions: FieldRegions,
  deps: FingerprintDeps = {},
): FieldFingerprints {
  const out: FieldFingerprints = {};
  const len = text.length;
  for (const [path, span] of Object.entries(regions)) {
    const [start, end] = span;
    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < 0 ||
      end < start ||
      end > len
    ) {
      deps.warn?.(`fingerprintFields: out-of-bounds region for "${path}" — skipping`);
      continue;
    }
    out[path] = fingerprintText(text.slice(start, end));
  }
  return out;
}
