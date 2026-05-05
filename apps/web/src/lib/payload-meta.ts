import {
  fingerprintFields,
  fingerprintText,
  type FieldFingerprints,
  type FieldRegions,
} from "@glyph/crypto";

/**
 * Signed payload sidecar for self-healing-sync.
 *
 * Travels INSIDE the encrypted bytes alongside the user-facing data so it
 * is automatically tamper-resistant: an attacker cannot rewrite the
 * fingerprints without also re-signing the payload, which requires the
 * signing key. Embedded XML hints (CompositionId, BlockIds in the
 * Custom XML / XMP) are convenience-only — `_meta` is the authority.
 */
export interface PayloadMeta {
  readonly fingerprints: FieldFingerprints;
  readonly regions: FieldRegions;
  /** SHA-256 of the normalized full source text, truncated to 16 hex. */
  readonly sourceTextHash: string;
  readonly schemaVersion: string;
  readonly blockIds: readonly string[] | null;
  readonly compositionId: string | null;
  readonly signedAt: string;
}

export interface BuildMetaArgs {
  readonly sourceText: string;
  readonly regions: FieldRegions;
  readonly schemaVersion: string;
  readonly blockIds?: readonly string[] | null;
  readonly compositionId?: string | null;
  /** Override `Date.now` for tests / replay. */
  readonly now?: () => Date;
}

export function buildMeta(args: BuildMetaArgs): PayloadMeta {
  const fingerprints = fingerprintFields(args.sourceText, args.regions);
  return {
    fingerprints,
    regions: args.regions,
    sourceTextHash: fingerprintText(args.sourceText),
    schemaVersion: args.schemaVersion,
    blockIds: args.blockIds ?? null,
    compositionId: args.compositionId ?? null,
    signedAt: (args.now?.() ?? new Date()).toISOString(),
  };
}

export function attachMeta<T extends object>(
  data: T,
  meta: PayloadMeta,
): T & { _meta: PayloadMeta } {
  return { ...data, _meta: meta };
}

export function stripMeta<T extends object>(
  data: T,
): { data: Omit<T, "_meta">; meta: PayloadMeta | null } {
  if (!isWithMeta(data)) {
    return { data: data as Omit<T, "_meta">, meta: null };
  }
  const { _meta, ...rest } = data as T & { _meta: PayloadMeta };
  return { data: rest as Omit<T, "_meta">, meta: _meta };
}

function isWithMeta(v: unknown): v is { _meta: PayloadMeta } {
  if (v === null || typeof v !== "object") return false;
  const meta = (v as { _meta?: unknown })._meta;
  if (meta === null || typeof meta !== "object") return false;
  const m = meta as Record<string, unknown>;
  return (
    typeof m.sourceTextHash === "string" &&
    typeof m.schemaVersion === "string" &&
    typeof m.signedAt === "string" &&
    m.fingerprints !== null &&
    typeof m.fingerprints === "object" &&
    m.regions !== null &&
    typeof m.regions === "object"
  );
}
