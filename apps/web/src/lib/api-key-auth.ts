/**
 * Bearer API key auth for plugin endpoints (/api/word/*, /api/gdocs/*).
 *
 * Mirrors the verification logic used by /api/v1/extract but returns the
 * authenticated key record instead of producing a response. Keeps the
 * plugin route handlers tiny.
 */

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { apiKeys } from "@/db/schema";
import { verifyApiKey } from "@glyph/crypto";

const API_KEY_PREFIX_LEN = 16;

export type ApiKeyRecord = typeof apiKeys.$inferSelect;

export type AuthResult =
  | { readonly ok: true; readonly key: ApiKeyRecord }
  | { readonly ok: false; readonly status: number; readonly code: string; readonly message: string };

export function parseBearer(header: string | null): string | null {
  if (header === null) return null;
  const m = /^Bearer\s+(\S+)$/i.exec(header);
  return m?.[1] ?? null;
}

export async function authenticateApiKey(
  authorizationHeader: string | null,
): Promise<AuthResult> {
  const raw = parseBearer(authorizationHeader);
  if (raw === null || raw.length < API_KEY_PREFIX_LEN) {
    return {
      ok: false,
      status: 401,
      code: "unauthorized",
      message: "Missing or malformed Bearer token.",
    };
  }
  const keyPrefix = raw.slice(0, API_KEY_PREFIX_LEN);

  const [keyRecord] = await db
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.keyPrefix, keyPrefix))
    .limit(1);

  if (keyRecord === undefined) {
    return {
      ok: false,
      status: 401,
      code: "unauthorized",
      message: "Invalid API key.",
    };
  }

  const ok = await verifyApiKey(raw, keyRecord.keyHash);
  if (!ok) {
    return {
      ok: false,
      status: 401,
      code: "unauthorized",
      message: "Invalid API key.",
    };
  }
  if (!keyRecord.isActive) {
    return {
      ok: false,
      status: 403,
      code: "revoked",
      message: "API key has been revoked.",
    };
  }

  return { ok: true, key: keyRecord };
}
