import { type NextRequest } from "next/server";

import { encryptPayload, signPayload } from "@glyph/crypto";

import { db } from "@/db";
import { documents } from "@/db/schema";
import { canonicalize } from "@/lib/canonicalize";

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

  const outcome = runValidation(body);
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

  const { encrypted, iv, tag } = await encryptPayload(canonical);
  const signature = await signPayload(encrypted);

  const schemaVersion =
    typeof (outcome.data as { schema_version?: unknown }).schema_version === "string"
      ? ((outcome.data as { schema_version: string }).schema_version)
      : DEFAULT_SCHEMA_VERSION;

  // Persist as a finalized document row so the web UI lists Word-originated
  // docs alongside ones authored in the editor.
  try {
    await db.insert(documents).values({
      userId: auth.userId,
      title: `${body.documentType} (Word)`,
      documentType: body.documentType,
      documentTypeKey: body.documentType,
      schemaVersion,
      validatedJson: outcome.data as Record<string, unknown>,
      encryptedPayload: encrypted,
      payloadIv: iv,
      payloadTag: tag,
      payloadSignature: signature,
      isFinalized: true,
    });
  } catch (e) {
    // DB persistence is best-effort from the plugin's perspective — the
    // encrypted payload is still safe to embed even if the row insert
    // failed. Log and continue.
    // eslint-disable-next-line no-console
    console.error("[word/finalize] insert failed", {
      userId: auth.userId,
      documentType: body.documentType,
      error: e instanceof Error ? e.message : String(e),
    });
  }

  return jsonWithCors(req, {
    encrypted,
    iv,
    tag,
    signature,
    schemaVersion,
    documentType: body.documentType,
  });
}
