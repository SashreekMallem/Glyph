/**
 * POST /api/v1/schemas/from-description
 *
 * Author flow: a user describes a document type in plain English
 * ("veterinary visit record for a small animal clinic"). We:
 *
 *   1. Derive a snake_case `typeKey` from the description (collision-safe
 *      against existing `document_types.key`).
 *   2. Ask Gemini to synthesize a JSON Schema Draft 7 from the description.
 *   3. Persist the schema to BOTH `schema_blocks` (as the canonical
 *      composable "base" block) and `document_types` (the front-door
 *      handle keyed by `typeKey`).
 *   4. Return `{ typeKey }` so the editor can switch immediately to the
 *      new doc type — the existing schema loader picks it up on next
 *      lookup (it checks `schema_blocks` first, then `document_types`).
 *
 * Auth   : Supabase session cookie (same as `/api/extract/stream`).
 * Errors : 401 unauthorized | 400 bad_request | 502 upstream_error |
 *          500 internal_error.
 *
 * Out of scope: tests (verified by curl), schema mutation/edit, multi-block
 * composition. The synthesized schema lives as a single `name="base"`
 * block — gap detection can append more blocks later.
 */

import { NextResponse, type NextRequest } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { and, eq, isNull, like, or } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { documentTypes, schemaBlocks } from "@/db/schema";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getExtractEnv, ExtractEnvError } from "@/lib/extract/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function err(
  status: number,
  code: string,
  message: string,
  extra: Record<string, unknown> = {},
): NextResponse {
  return NextResponse.json({ error: { code, message, ...extra } }, { status });
}

const BodySchema = z.object({
  description: z.string().trim().min(10).max(500),
});

// ---------------------------------------------------------------------------
// Slug derivation
//
// Strategy: lowercase the description, strip punctuation, drop a small set
// of leading filler words ("a", "the", "an", "for", "of"...), then take the
// first 1-4 meaningful tokens up to a reasonable length. We bias toward
// keeping a useful noun phrase: "Veterinary visit record for a small
// animal clinic" → ["veterinary", "visit", "record", "for", ...] → take
// the run before the first stop word that ISN'T at the start.
//
// Examples:
//   "Veterinary visit record for a small animal clinic"
//     → "veterinary_visit_record"
//   "an invoice with line items and tax"
//     → "invoice_with_line_items"   (stops at "and")
//   "Patient intake form"  → "patient_intake_form"
// ---------------------------------------------------------------------------

const LEADING_FILLERS = new Set(["a", "an", "the"]);
const STOP_AFTER_FIRST = new Set([
  "for",
  "of",
  "and",
  "or",
  "with",
  "in",
  "on",
  "at",
  "to",
  "from",
  "by",
  "about",
  "that",
  "which",
]);
const MAX_SLUG_TOKENS = 4;
const MAX_SLUG_LENGTH = 60;

function tokenize(description: string): string[] {
  return description
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]+/g, " ")
    .split(/[\s_-]+/g)
    .filter((t) => t.length > 0);
}

function slugFromDescription(description: string): string {
  const tokens = tokenize(description);

  // Drop leading articles ("a", "an", "the").
  let i = 0;
  while (i < tokens.length && LEADING_FILLERS.has(tokens[i]!)) i++;

  const picked: string[] = [];
  for (; i < tokens.length && picked.length < MAX_SLUG_TOKENS; i++) {
    const t = tokens[i]!;
    if (picked.length > 0 && STOP_AFTER_FIRST.has(t)) break;
    if (LEADING_FILLERS.has(t)) continue;
    picked.push(t);
  }

  // Fallback: if filtering left us empty, use the raw first 3 tokens.
  const chosen = picked.length > 0 ? picked : tokens.slice(0, 3);
  const slug = chosen.join("_").slice(0, MAX_SLUG_LENGTH);
  return slug.length > 0 ? slug : "custom_document";
}

/**
 * Resolve `baseSlug` to a key that does NOT already exist in
 * `document_types`. Appends `_v2`, `_v3`, ... until a free slot is found.
 */
async function findFreeTypeKey(baseSlug: string): Promise<string> {
  // Pull every existing key that starts with the base slug in one query so
  // we don't loop with N round-trips against the DB.
  const existing = (await db
    .select({ key: documentTypes.key })
    .from(documentTypes)
    .where(
      or(
        eq(documentTypes.key, baseSlug),
        like(documentTypes.key, `${baseSlug}_v%`),
      ),
    )
    .limit(100)) as Array<{ key: string }>;

  const taken = new Set(existing.map((r) => r.key));
  if (!taken.has(baseSlug)) return baseSlug;

  for (let v = 2; v < 1000; v++) {
    const candidate = `${baseSlug}_v${v}`;
    if (!taken.has(candidate)) return candidate;
  }
  // Astronomically unlikely fallback.
  return `${baseSlug}_v${Date.now()}`;
}

function humanizeKey(key: string): string {
  return key
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// ---------------------------------------------------------------------------
// Gemini synthesis
// ---------------------------------------------------------------------------

const SYNTHESIS_PROMPT = `You are designing a JSON Schema Draft 7 for a new document type.

The user described the document as:
"""
{{DESCRIPTION}}
"""

The proposed type key is: {{TYPE_KEY}}

Generate a JSON Schema that captures this document's likely structure as a
strict, machine-readable object.

REQUIREMENTS:
- Top-level "type" must be "object".
- "properties" must be a non-empty map.
- For repeating sections, use "type": "array" with "items" describing each entry.
- Field types must be one of: "string", "number", "integer", "boolean", "array", "object".
- EVERY leaf field MUST have a "description" of 5-12 words. Downstream NER
  models rely on these as inference hints — missing descriptions cause extraction failure.
- Prefer short, snake_case keys.
- DO NOT include "additionalProperties: false" — keep the schema permissive.
- DO NOT include "$schema" or "$id".

OUTPUT FORMAT: ONLY the JSON Schema, no prose, no markdown fences.`;

const SYNTHESIS_TIMEOUT_MS = 15_000;

function isValidObjectSchema(v: unknown): v is Record<string, unknown> {
  if (typeof v !== "object" || v === null) return false;
  const obj = v as Record<string, unknown>;
  if (obj.type !== "object") return false;
  if (typeof obj.properties !== "object" || obj.properties === null) {
    return false;
  }
  return Object.keys(obj.properties as Record<string, unknown>).length > 0;
}

interface SynthResult {
  readonly jsonSchema: Record<string, unknown>;
  readonly error?: undefined;
}
interface SynthError {
  readonly jsonSchema?: undefined;
  readonly error: string;
}

async function synthesizeFromDescription(args: {
  readonly description: string;
  readonly typeKey: string;
  readonly apiKey: string;
  readonly model: string;
}): Promise<SynthResult | SynthError> {
  const prompt = SYNTHESIS_PROMPT.replace("{{DESCRIPTION}}", args.description).replace(
    "{{TYPE_KEY}}",
    args.typeKey,
  );

  const ai = new GoogleGenAI({ apiKey: args.apiKey });
  const aborter = new AbortController();
  const timer = setTimeout(() => aborter.abort(), SYNTHESIS_TIMEOUT_MS);

  try {
    const result = await ai.models.generateContent({
      model: args.model,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        responseMimeType: "application/json",
        temperature: 0.2,
      },
    });

    const raw = result.text;
    if (typeof raw !== "string" || raw.length === 0) {
      return { error: "Gemini returned an empty response." };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { error: "Gemini returned non-JSON content." };
    }

    if (!isValidObjectSchema(parsed)) {
      return {
        error:
          "Synthesized schema is not a valid object schema with non-empty properties.",
      };
    }

    return { jsonSchema: parsed };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { error: `Gemini synthesis failed: ${message}` };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

const DOCUMENT_TYPES_DESC_MAX = 280;

async function persist(args: {
  readonly typeKey: string;
  readonly description: string;
  readonly schemaJson: Record<string, unknown>;
  readonly userId: string;
}): Promise<void> {
  const blockId = `${args.typeKey}.base.v1`;

  await db
    .insert(schemaBlocks)
    .values({
      id: blockId,
      domain: args.typeKey,
      name: "base",
      version: "v1",
      jsonSchema: args.schemaJson,
      isCurated: false,
      isRequiredForDomain: true,
      dependsOn: [],
      proposedByUserId: args.userId,
    })
    .onConflictDoNothing();

  await db
    .insert(documentTypes)
    .values({
      key: args.typeKey,
      name: humanizeKey(args.typeKey),
      description: args.description.slice(0, DOCUMENT_TYPES_DESC_MAX),
      schemaVersion: "v1",
      jsonSchema: args.schemaJson,
      rendererId: "generic",
      isSystem: false,
      userId: args.userId,
    })
    .onConflictDoNothing();
}

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest): Promise<NextResponse> {
  // --- Env (Gemini key + model). ---
  let env;
  try {
    env = getExtractEnv();
  } catch (e) {
    if (e instanceof ExtractEnvError) {
      return err(
        503,
        "service_unavailable",
        "schema synthesis pipeline is not configured",
      );
    }
    throw e;
  }

  // --- Auth (Supabase session cookie). ---
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return err(401, "unauthorized", "no session");
  }
  const userId = user.id;

  // --- Body validation. ---
  let description: string;
  try {
    const raw = (await req.json()) as unknown;
    const parsed = BodySchema.safeParse(raw);
    if (!parsed.success) {
      return err(400, "bad_request", "Body validation failed.", {
        issues: parsed.error.issues,
      });
    }
    description = parsed.data.description;
  } catch {
    return err(400, "bad_request", "Body is not valid JSON.");
  }

  // --- Derive a free typeKey. ---
  let typeKey: string;
  try {
    const base = slugFromDescription(description);
    typeKey = await findFreeTypeKey(base);
    // Suppress unused-var lint on the userId-scoped lookup if it ever
    // diverges from the global lookup; today we treat the key namespace
    // as global so we don't need it here.
    void userId;
  } catch (e) {
    return err(
      500,
      "internal_error",
      `failed to resolve typeKey: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  // --- Gemini synthesis. ---
  const synth = await synthesizeFromDescription({
    description,
    typeKey,
    apiKey: env.geminiApiKey,
    model: env.geminiModel,
  });
  if (synth.error !== undefined) {
    return err(502, "upstream_error", synth.error);
  }

  // --- Persist. ---
  try {
    await persist({
      typeKey,
      description,
      schemaJson: synth.jsonSchema,
      userId,
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[schemas/from-description] persist failed", {
      typeKey,
      error: e instanceof Error ? e.message : String(e),
    });
    return err(500, "internal_error", "Failed to persist synthesized schema.");
  }

  // Sanity: confirm at least one of the two rows landed. If both inserts
  // hit `onConflictDoNothing` we'd still return the typeKey, but a SELECT
  // here lets us surface a real internal_error vs. silently returning a
  // typeKey the loader can't resolve.
  const planted = await db
    .select({ key: documentTypes.key })
    .from(documentTypes)
    .where(
      and(
        eq(documentTypes.key, typeKey),
        or(isNull(documentTypes.userId), eq(documentTypes.userId, userId)),
      ),
    )
    .limit(1);

  if (planted.length === 0) {
    // Block insert may have succeeded — still a valid resolution path, but
    // we couldn't confirm via document_types. Treat as soft success: the
    // schema loader's blocks-first path will pick the row up.
    const blockPlanted = await db
      .select({ id: schemaBlocks.id })
      .from(schemaBlocks)
      .where(eq(schemaBlocks.domain, typeKey))
      .limit(1);
    if (blockPlanted.length === 0) {
      return err(
        500,
        "internal_error",
        "Schema synthesis succeeded but persistence left no rows.",
      );
    }
  }

  return NextResponse.json({ typeKey }, { status: 200 });
}

// ---------------------------------------------------------------------------
// Method guards (mirror the pattern in /api/v1/extract/gliner).
// ---------------------------------------------------------------------------

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
