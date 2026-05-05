import { NextResponse, type NextRequest } from "next/server";
import { z, type ZodIssue } from "zod";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { extractHeuristic } from "@/lib/extract/heuristic";
import {
  isBuiltInType,
  resolveSchema,
  type ResolvedSchema,
} from "@/server/documentRegistry";

/** Origins the plugin may legitimately load from. */
const ALLOWED_ORIGINS: ReadonlySet<string> = new Set([
  "https://localhost:3002",
  "https://glyph.dev",
]);

/**
 * Resolve the CORS `Access-Control-Allow-Origin` value.
 *
 * We echo the caller's Origin iff it's on our allow-list — Office Add-ins
 * run inside webviews that send real Origin headers for fetches. Returning
 * `null` means the endpoint refuses to participate in CORS for that caller.
 */
export function resolveCorsOrigin(req: NextRequest): string | null {
  const origin = req.headers.get("origin");
  if (origin !== null && ALLOWED_ORIGINS.has(origin)) return origin;
  return null;
}

export function corsHeaders(origin: string | null): Record<string, string> {
  if (origin === null) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    Vary: "Origin",
  };
}

export function preflight(req: NextRequest): NextResponse {
  const origin = resolveCorsOrigin(req);
  return new NextResponse(null, { status: 204, headers: corsHeaders(origin) });
}

export function jsonWithCors(
  req: NextRequest,
  body: unknown,
  status = 200,
): NextResponse {
  const origin = resolveCorsOrigin(req);
  return NextResponse.json(body, { status, headers: corsHeaders(origin) });
}

const RegionTuple = z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]);

const BodySchema = z.object({
  documentType: z.string().min(1),
  text: z.string().min(1),
  blockIds: z.array(z.string()).optional(),
  /**
   * Optional: plugin-provided per-leaf field regions (dot-notation
   * path → `[start, end)` offsets into `text`). When present we sign
   * fingerprints into the payload so the sync endpoint can detect
   * field-level drift on later reads.
   */
  regions: z.record(z.string(), RegionTuple).optional(),
});

export interface ParsedBody {
  readonly documentType: string;
  readonly text: string;
  readonly blockIds?: readonly string[];
  readonly regions?: Record<string, [number, number]>;
}

export async function parseBody(
  req: NextRequest,
): Promise<ParsedBody | NextResponse> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return jsonWithCors(req, { error: "Invalid JSON body." }, 400);
  }
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return jsonWithCors(
      req,
      { error: "Body must be { documentType, text }.", issues: parsed.error.issues },
      400,
    );
  }
  return {
    documentType: parsed.data.documentType,
    text: parsed.data.text,
    blockIds: parsed.data.blockIds,
    regions: parsed.data.regions as Record<string, [number, number]> | undefined,
  };
}

/**
 * Require a signed-in Supabase user. Returns the user id or a 401 response.
 */
export async function requireUser(
  req: NextRequest,
): Promise<{ userId: string } | NextResponse> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user === null) {
    return jsonWithCors(req, { error: "Not signed in." }, 401);
  }
  return { userId: user.id };
}

export interface ValidationOutcome {
  readonly extracted: Record<string, unknown>;
  readonly errors: ReadonlyArray<Pick<ZodIssue, "path" | "message" | "code">>;
  readonly valid: boolean;
  readonly data: unknown | null;
  readonly resolved: ResolvedSchema | null;
}

/** Shared validation pipeline: extract heuristically, then Zod-parse.
 *  For built-in types the heuristic extractor runs first; for custom types
 *  the raw text is passed as-is (structured_data should come from the caller).
 *  Schema resolution supports blocks/compositions, custom types, and built-ins.
 */
export async function runValidation(body: ParsedBody): Promise<ValidationOutcome> {
  const extracted = isBuiltInType(body.documentType)
    ? extractHeuristic(body.documentType, body.text).extracted
    : ({ raw_text: body.text } as Record<string, unknown>);

  let resolved: ResolvedSchema;
  try {
    resolved = await resolveSchema({
      documentType: body.documentType,
      blockIds: body.blockIds,
    });
  } catch {
    return { extracted, errors: [], valid: false, data: null, resolved: null };
  }

  const parsed = resolved.zod.safeParse(extracted);
  if (parsed.success) {
    return { extracted, errors: [], valid: true, data: parsed.data, resolved };
  }
  return {
    extracted,
    errors: parsed.error.issues.map((i) => ({
      path: i.path,
      message: i.message,
      code: i.code,
    })),
    valid: false,
    data: null,
    resolved,
  };
}
