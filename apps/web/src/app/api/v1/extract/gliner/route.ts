/**
 * POST /api/v1/extract/gliner
 *
 * Thin proxy in front of the GLiNER2 Python service. This is the
 * direct-API entry point — Word/GDocs plugins, curl, and any future
 * external consumer hits this route. The SSE editor stream (used by the
 * web editor) reaches GLiNER2 via `/api/extract/stream`, where GLiNER2
 * is wired in as a fast-path *before* the Gemini fallback. Both call
 * sites pay the same Bearer-auth + Upstash rate-limit toll.
 *
 * Body  : { text, doc_type, schema_hint? }
 * Auth  : Bearer API key (same pattern as `/api/v1/extract`).
 * Routes: POST → forward to ${GLINER_SERVICE_URL}/v1/extract; returns
 *         the upstream JSON verbatim. Failures bubble up as 502.
 *
 * NOTE on path: the spec called for `/api/v1/extract`, but that path is
 * already occupied by the legacy encrypted-payload + raw-text extractor
 * (route.ts beside this file), and its tests are out of scope to
 * modify. The sub-path keeps both endpoints alive and the test suite
 * green.
 */

import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { apiKeys } from "@/db/schema";
import { verifyApiKey } from "@glyph/crypto";
import { getExtractLimiter } from "@/lib/extract-ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const API_KEY_PREFIX_LEN = 16;

const BodySchema = z.object({
  text: z.string().min(1),
  doc_type: z.enum(["resume", "contract", "invoice"]),
  schema_hint: z.record(z.string(), z.unknown()).optional(),
});

interface GlinerSpan {
  readonly path: string;
  readonly value: unknown;
  readonly start: number;
  readonly end: number;
  readonly confidence: number;
}

interface GlinerResponse {
  readonly spans: readonly GlinerSpan[];
  readonly structured: Record<string, unknown>;
  readonly min_confidence: number;
  readonly avg_confidence: number;
  readonly duration_ms: number;
  readonly model: string;
}

function err(
  status: number,
  code: string,
  message: string,
  extra: Record<string, unknown> = {},
): NextResponse {
  return NextResponse.json({ error: { code, message, ...extra } }, { status });
}

function parseBearer(header: string | null): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(\S+)$/i.exec(header);
  return m?.[1] ?? null;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const started = Date.now();
  let keyPrefix: string | null = null;

  try {
    // 1. Bearer auth
    const raw = parseBearer(req.headers.get("authorization"));
    if (!raw || raw.length < API_KEY_PREFIX_LEN) {
      return err(401, "unauthorized", "Missing or malformed Bearer token.");
    }
    keyPrefix = raw.slice(0, API_KEY_PREFIX_LEN);

    const [keyRecord] = await db
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.keyPrefix, keyPrefix))
      .limit(1);
    if (!keyRecord) return err(401, "unauthorized", "Invalid API key.");
    const ok = await verifyApiKey(raw, keyRecord.keyHash);
    if (!ok) return err(401, "unauthorized", "Invalid API key.");
    if (!keyRecord.isActive)
      return err(403, "revoked", "API key has been revoked.");

    // 2. Rate limit (shared with the legacy /api/v1/extract bucket so a
    //    misbehaving caller can't dodge limits by hopping endpoints).
    const limiter = getExtractLimiter();
    if (limiter) {
      const { success } = await limiter.limit(keyRecord.id);
      if (!success) {
        return err(429, "rate_limit_exceeded", "Daily request limit reached.");
      }
    }

    // 3. Parse body
    let body: z.infer<typeof BodySchema>;
    try {
      const json = (await req.json()) as unknown;
      const parsed = BodySchema.safeParse(json);
      if (!parsed.success) {
        return err(400, "bad_request", "Body validation failed.", {
          issues: parsed.error.issues,
        });
      }
      body = parsed.data;
    } catch {
      return err(400, "bad_request", "Body is not valid JSON.");
    }

    // 4. Forward to GLiNER2 service
    const glinerUrl = process.env.GLINER_SERVICE_URL;
    if (!glinerUrl) {
      return err(
        503,
        "service_unavailable",
        "GLINER_SERVICE_URL is not configured.",
      );
    }

    let upstream: Response;
    try {
      upstream = await fetch(`${glinerUrl}/v1/extract`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text: body.text,
          doc_type: body.doc_type,
          ...(body.schema_hint ? { schema_hint: body.schema_hint } : {}),
        }),
        // Direct-API consumers may pass longer documents than the SSE
        // fast-path — give the upstream a generous 30s before we bail.
        signal: AbortSignal.timeout(30_000),
      });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[extract/gliner] upstream_unreachable", {
        keyPrefix,
        durationMs: Date.now() - started,
        error: e instanceof Error ? e.message : String(e),
      });
      return err(502, "upstream_error", "GLiNER2 service unreachable.");
    }

    if (!upstream.ok) {
      // eslint-disable-next-line no-console
      console.error("[extract/gliner] upstream_status", {
        keyPrefix,
        status: upstream.status,
        durationMs: Date.now() - started,
      });
      return err(502, "upstream_error", `GLiNER2 returned ${upstream.status}.`);
    }

    let payload: GlinerResponse;
    try {
      payload = (await upstream.json()) as GlinerResponse;
    } catch {
      return err(502, "upstream_error", "GLiNER2 returned malformed JSON.");
    }

    // Verbatim pass-through; the upstream owns the response contract.
    return NextResponse.json(payload, { status: 200 });
  } catch (e) {
    const duration = Date.now() - started;
    // eslint-disable-next-line no-console
    console.error("[extract/gliner] error", {
      keyPrefix,
      durationMs: duration,
      error: e instanceof Error ? e.message : String(e),
    });
    return err(500, "internal_error", "Request failed.");
  } finally {
    // eslint-disable-next-line no-console
    console.log("[extract/gliner] done", {
      keyPrefix,
      durationMs: Date.now() - started,
    });
  }
}

function methodNotAllowed(): NextResponse {
  return err(405, "method_not_allowed", "POST only.");
}
export async function GET(): Promise<NextResponse> {
  return methodNotAllowed();
}
export async function PUT(): Promise<NextResponse> {
  return methodNotAllowed();
}
export async function DELETE(): Promise<NextResponse> {
  return methodNotAllowed();
}
export async function PATCH(): Promise<NextResponse> {
  return methodNotAllowed();
}
