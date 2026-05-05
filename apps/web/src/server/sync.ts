/**
 * Self-healing-sync orchestrator.
 *
 * Given a parsed document bundle (visible text + embedded encrypted
 * fields), this module:
 *   1. Decrypts + verifies the embedded payload
 *   2. Strips `_meta` to recover the last-signed regions/fingerprints
 *   3. Detects field-level drift against the current visible text
 *   4. If drifted: re-extracts ONLY the changed paths (cheap), merges,
 *      re-fingerprints, re-encrypts, re-signs
 *   5. Returns the updated payload + a fresh `EmbeddedFields` ready to
 *      write back into the document
 *
 * No HTTP plumbing here — that's `apps/web/src/app/api/v1/sync/route.ts`.
 */

import {
  decryptPayload,
  encryptPayload,
  signPayload,
  verifySignature,
  DecryptionError,
} from "@glyph/crypto";

import { canonicalize } from "@/lib/canonicalize";
import {
  attachMeta,
  buildMeta,
  stripMeta,
  type PayloadMeta,
} from "@/lib/payload-meta";
import { extractOneShot } from "@/lib/extract/oneshot";
import type { EmbeddedFields } from "@/lib/sync/file-io";
import { detectDrift, type DriftReport } from "@/server/drift";

export type SyncStatus = "in_sync" | "synced" | "no_payload" | "decryption_failed";

export interface SyncInput {
  readonly visibleText: string;
  readonly embedded: EmbeddedFields | null;
  readonly userId: string;
  /** Override clock for tests. */
  readonly now?: () => Date;
}

export interface SyncResult {
  readonly status: SyncStatus;
  readonly data: Record<string, unknown> | null;
  readonly meta: PayloadMeta | null;
  readonly drift: DriftReport | null;
  readonly signatureValid: boolean;
  /** Refreshed embedded fields to write back into the document. Null when no rebundle is needed (`in_sync`) or possible (`no_payload`). */
  readonly newEmbedded: EmbeddedFields | null;
  readonly documentType: string | null;
  readonly schemaVersion: string | null;
}

export async function syncDocument(input: SyncInput): Promise<SyncResult> {
  const { visibleText, embedded, userId } = input;
  const now = input.now ?? (() => new Date());

  if (!embedded) {
    return {
      status: "no_payload",
      data: null,
      meta: null,
      drift: null,
      signatureValid: false,
      newEmbedded: null,
      documentType: null,
      schemaVersion: null,
    };
  }

  let signatureValid = false;
  try {
    signatureValid = await verifySignature(embedded.encrypted, embedded.signature);
  } catch {
    signatureValid = false;
  }

  let decoded: Record<string, unknown>;
  try {
    decoded = (await decryptPayload(
      embedded.encrypted,
      embedded.iv,
      embedded.tag,
    )) as Record<string, unknown>;
  } catch (e) {
    if (e instanceof DecryptionError) {
      return {
        status: "decryption_failed",
        data: null,
        meta: null,
        drift: null,
        signatureValid,
        newEmbedded: null,
        documentType: embedded.documentType,
        schemaVersion: embedded.schemaVersion,
      };
    }
    throw e;
  }

  const { data: bareData, meta: oldMeta } = stripMeta(decoded);

  // No `_meta` means the document predates the self-healing feature. We
  // can't drift-detect — return the data as-is and flag for full re-extract
  // upstream if the caller cares.
  if (!oldMeta) {
    return {
      status: "in_sync",
      data: bareData as Record<string, unknown>,
      meta: null,
      drift: null,
      signatureValid,
      newEmbedded: null,
      documentType: embedded.documentType,
      schemaVersion: embedded.schemaVersion,
    };
  }

  const drift = detectDrift({
    currentText: visibleText,
    currentRegions: oldMeta.regions,
    embeddedFingerprints: oldMeta.fingerprints,
    embeddedRegions: oldMeta.regions,
  });

  if (!drift.hasDrift) {
    return {
      status: "in_sync",
      data: bareData as Record<string, unknown>,
      meta: oldMeta,
      drift,
      signatureValid,
      newEmbedded: null,
      documentType: embedded.documentType,
      schemaVersion: embedded.schemaVersion,
    };
  }

  // Drift detected — re-extract just the changed/added paths.
  const onlyPaths = [...drift.changed, ...drift.added];
  const reExtract = await extractOneShot({
    text: visibleText,
    typeKey: embedded.documentType,
    userId,
    onlyPaths: onlyPaths.length > 0 ? onlyPaths : undefined,
  });

  // Merge: start from old data, overlay re-extracted leaves, drop removed.
  const merged: Record<string, unknown> = { ...(bareData as Record<string, unknown>) };
  if (reExtract.json && typeof reExtract.json === "object") {
    deepMerge(merged, reExtract.json as Record<string, unknown>);
  }
  for (const path of drift.removed) {
    deletePath(merged, path);
  }

  // Build new meta: union of old regions + re-extracted regions, last
  // writer wins. Old regions for unchanged fields stay valid.
  const newRegions = { ...oldMeta.regions, ...reExtract.regions };
  for (const path of drift.removed) {
    delete newRegions[path];
  }
  const newMeta = buildMeta({
    sourceText: visibleText,
    regions: newRegions,
    schemaVersion: embedded.schemaVersion,
    blockIds: embedded.blockIds ?? null,
    compositionId: embedded.compositionId ?? null,
    now,
  });

  const canonical = canonicalize(merged);
  if (
    canonical === null ||
    typeof canonical !== "object" ||
    Array.isArray(canonical)
  ) {
    throw new Error("sync: canonical merged payload is not an object");
  }
  const withMeta = attachMeta(canonical as Record<string, unknown>, newMeta);
  const enc = await encryptPayload(withMeta);
  const sig = await signPayload(enc.encrypted);

  const newEmbedded: EmbeddedFields = {
    encrypted: enc.encrypted,
    iv: enc.iv,
    tag: enc.tag,
    signature: sig,
    documentType: embedded.documentType,
    schemaVersion: embedded.schemaVersion,
    timestamp: newMeta.signedAt,
    compositionId: embedded.compositionId ?? null,
    blockIds: embedded.blockIds ?? null,
  };

  return {
    status: "synced",
    data: merged,
    meta: newMeta,
    drift,
    signatureValid,
    newEmbedded,
    documentType: embedded.documentType,
    schemaVersion: embedded.schemaVersion,
  };
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): void {
  for (const [k, v] of Object.entries(source)) {
    if (isPlainObject(v) && isPlainObject(target[k])) {
      deepMerge(target[k] as Record<string, unknown>, v);
    } else {
      target[k] = v;
    }
  }
}

function deletePath(obj: Record<string, unknown>, dotPath: string): void {
  const parts = dotPath.split(".");
  let cur: unknown = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!isPlainObject(cur)) return;
    cur = cur[parts[i]!];
  }
  if (isPlainObject(cur)) {
    delete cur[parts[parts.length - 1]!];
  }
}
