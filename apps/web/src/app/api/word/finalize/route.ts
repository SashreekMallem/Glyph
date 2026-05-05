/**
 * POST /api/word/finalize
 *
 * First-time finalize for Word-originated documents. Validates,
 * canonicalizes, attaches `_meta` (signed fingerprints + regions),
 * encrypts, and signs — returns the encrypted blob for the Word plugin to
 * embed into the .docx Custom XML Part.
 *
 * On every subsequent open/save the plugin should call `/api/v1/sync`
 * instead. That endpoint detects field-level drift and refreshes the
 * embedded payload field-by-field — no full re-extraction needed.
 *
 * Does NOT persist to DB — payload travels with the document.
 */

import { type NextRequest } from "next/server";

import { encryptPayload, signPayload } from "@glyph/crypto";

import { canonicalize } from "@/lib/canonicalize";
import { attachMeta, buildMeta } from "@/lib/payload-meta";

import {
  jsonWithCors,
  parseBody,
  preflight,
  requireUser,
  runValidation,
} from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_SCHEMA_VERSION = "1.0";

export async function OPTIONS(req: NextRequest) {
  return preflight(req);
}

export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;

  const body = await parseBody(req);
  if (body instanceof Response) return body;

  const outcome = await runValidation(body);
  if (!outcome.valid || outcome.data === null) {
    return jsonWithCors(
      req,
      {
        error: "Document did not pass schema validation.",
        errors: outcome.errors,
        extracted: outcome.extracted,
      },
      400,
    );
  }

  const canonical = canonicalize(outcome.data);
  if (canonical === null || typeof canonical !== "object" || Array.isArray(canonical)) {
    return jsonWithCors(req, { error: "Canonical payload must be an object." }, 500);
  }

  const schemaVersion =
    typeof (outcome.data as { schema_version?: unknown }).schema_version === "string"
      ? ((outcome.data as { schema_version: string }).schema_version)
      : DEFAULT_SCHEMA_VERSION;

  // Self-healing-sync metadata: per-leaf fingerprints + regions inside the
  // signed envelope. If the plugin didn't send regions, we sign empty maps
  // so the sync endpoint can still authenticate the payload — drift then
  // forces a full re-extract on the first sync call.
  const meta = buildMeta({
    sourceText: body.text,
    regions: body.regions ?? {},
    schemaVersion,
    blockIds: outcome.resolved?.blockIds ?? null,
    compositionId: outcome.resolved?.compositionId ?? null,
  });
  const withMeta = attachMeta(canonical as Record<string, unknown>, meta);

  const { encrypted, iv, tag } = await encryptPayload(withMeta);
  const signature = await signPayload(encrypted);

  // No DB persistence: the .docx Custom XML Part is the storage medium for
  // Word-originated documents. Keeping plaintext validated JSON in Postgres
  // would be a data-leak surface for no benefit.

  return jsonWithCors(req, {
    encrypted,
    iv,
    tag,
    signature,
    schemaVersion,
    documentType: body.documentType,
    compositionId: outcome.resolved?.compositionId ?? null,
    blockIds: outcome.resolved?.blockIds ?? null,
  });
}
