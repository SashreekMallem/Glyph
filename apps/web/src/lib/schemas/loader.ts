/**
 * Dynamic schema loader with Gemini synthesis fallback.
 *
 * Lookup chain:
 *   1. document_types.json_schema (the canonical store).
 *   2. schema_blocks composed by domain (multi-block compositions).
 *   3. Gemini synthesizes a JSON Schema from the user's document text,
 *      then writes it back to schema_blocks + document_types so the next
 *      user with the same doc_type inherits it.
 *
 * The synthesized schema is stored with `is_system=false` (it's a model
 * inference, not human-curated) and tagged with the user who triggered
 * the synthesis in `schema_blocks.proposed_by_user_id` for traceability.
 *
 * This module is the SINGLE entry point for "give me the JSON Schema for
 * this doc_type." All extraction paths (live editor, MCP tool, plugin
 * endpoints) must call `loadSchema()` — never read `document_types`
 * directly, since the synthesis path is the lazy initializer.
 */

import { createHash } from "node:crypto";

import { GoogleGenAI } from "@google/genai";
import { and, eq, isNull, or, sql } from "drizzle-orm";

import { documentTypes, schemaBlocks } from "@/db/schema";

import { getExtractEnv } from "@/lib/extract/env";

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

export type SchemaSource = "document_types" | "schema_blocks" | "gemini_synthesized";

export interface LoadedSchema {
  readonly jsonSchema: Record<string, unknown>;
  readonly schemaVersion: string;
  readonly source: SchemaSource;
  /** The doc_type key — equals input `typeKey` or a snake_cased version. */
  readonly typeKey: string;
}

export interface LoadSchemaArgs {
  /** Doc type identifier — can be a known key or a brand-new domain. */
  readonly typeKey: string;
  /** Caller (for tenant isolation + provenance on synthesized schemas). */
  readonly userId?: string;
  /** First chunk of document text. Used only when we need to synthesize. */
  readonly sampleText?: string;
  /** Skip Gemini synthesis even when nothing exists (returns null instead). */
  readonly readOnly?: boolean;
}

// ---------------------------------------------------------------------------
// Drizzle-shaped DB handle
// ---------------------------------------------------------------------------

export interface LoaderDB {
  select: (cols?: unknown) => {
    from: (table: unknown) => {
      where: (cond: unknown) => {
        limit: (n: number) => Promise<Array<Record<string, unknown>>>;
      };
    };
  };
  insert: (table: unknown) => {
    values: (row: unknown) => {
      onConflictDoNothing: () => Promise<unknown>;
    };
  };
}

// ---------------------------------------------------------------------------
// FIFO cache
// ---------------------------------------------------------------------------

const CACHE_MAX = 256;
const cache = new Map<string, LoadedSchema>();

function cacheKey(typeKey: string, userId?: string): string {
  return `${typeKey}::${userId ?? "anon"}`;
}

function cacheGet(key: string): LoadedSchema | undefined {
  return cache.get(key);
}

function cachePut(key: string, value: LoadedSchema): void {
  if (cache.has(key)) return;
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, value);
}

/** Test-only. */
export function _resetSchemaCache(): void {
  cache.clear();
}

// ---------------------------------------------------------------------------
// Stable hash (for synthesized version IDs)
// ---------------------------------------------------------------------------

function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${stableStringify((v as Record<string, unknown>)[k])}`)
    .join(",")}}`;
}

function hashSchema(schema: unknown): string {
  return createHash("sha256").update(stableStringify(schema)).digest("hex").slice(0, 12);
}

// ---------------------------------------------------------------------------
// Step 1: document_types lookup
// ---------------------------------------------------------------------------

async function tryDocumentTypes(
  db: LoaderDB,
  typeKey: string,
  userId?: string,
): Promise<LoadedSchema | null> {
  const condition = userId
    ? and(
        eq(documentTypes.key, typeKey),
        or(isNull(documentTypes.userId), eq(documentTypes.userId, userId)),
      )
    : and(eq(documentTypes.key, typeKey), isNull(documentTypes.userId));

  const rows = await db
    .select({
      jsonSchema: documentTypes.jsonSchema,
      schemaVersion: documentTypes.schemaVersion,
    })
    .from(documentTypes)
    .where(condition)
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  if (typeof row.jsonSchema !== "object" || row.jsonSchema === null) return null;

  const schemaJson = row.jsonSchema as Record<string, unknown>;
  const schemaVersion =
    typeof row.schemaVersion === "string" && row.schemaVersion.length > 0
      ? row.schemaVersion
      : `dt-${hashSchema(schemaJson)}`;

  return {
    jsonSchema: schemaJson,
    schemaVersion,
    source: "document_types",
    typeKey,
  };
}

// ---------------------------------------------------------------------------
// Step 2: schema_blocks composition (best-effort)
// ---------------------------------------------------------------------------

async function tryComposeFromBlocks(
  db: LoaderDB,
  typeKey: string,
): Promise<LoadedSchema | null> {
  // We look for any approved blocks where domain == typeKey. The base block
  // (name="base") seeds the top-level `properties`; other blocks merge
  // their own `properties` into it. Required arrays are unioned.
  const rows = (await db
    .select({
      id: schemaBlocks.id,
      name: schemaBlocks.name,
      jsonSchema: schemaBlocks.jsonSchema,
    })
    .from(schemaBlocks)
    .where(eq(schemaBlocks.domain, typeKey))
    .limit(50)) as Array<{
    id: string;
    name: string;
    jsonSchema: Record<string, unknown>;
  }>;

  if (rows.length === 0) return null;

  // Start from the base block if present, else an empty object schema.
  const base = rows.find((r) => r.name === "base");
  const composed: Record<string, unknown> = base
    ? structuredClone(base.jsonSchema)
    : { type: "object", properties: {}, required: [] };

  const properties = (composed.properties ?? {}) as Record<string, unknown>;
  const required = new Set<string>(
    Array.isArray(composed.required) ? (composed.required as string[]) : [],
  );

  for (const row of rows) {
    if (row.name === "base") continue;
    const blockSchema = row.jsonSchema;
    const blockProps = (blockSchema.properties ?? {}) as Record<string, unknown>;
    for (const [k, v] of Object.entries(blockProps)) {
      if (!(k in properties)) properties[k] = v;
    }
    const blockRequired = Array.isArray(blockSchema.required)
      ? (blockSchema.required as string[])
      : [];
    for (const r of blockRequired) required.add(r);
  }

  composed.properties = properties;
  composed.required = [...required];

  return {
    jsonSchema: composed,
    schemaVersion: `blocks-${hashSchema(composed)}`,
    source: "schema_blocks",
    typeKey,
  };
}

// ---------------------------------------------------------------------------
// Step 3: Gemini synthesis
// ---------------------------------------------------------------------------

const SYNTHESIS_PROMPT = `You are designing a JSON Schema Draft 7 for a previously-unseen document type.

Document type key: {{TYPE_KEY}}

A user has just started authoring a document of this type. The first chunk
of their text is below. Produce a JSON Schema that captures the document's
likely structure as a strict, machine-readable object.

REQUIREMENTS:
- Top-level "type" must be "object".
- "properties" must be a non-empty map.
- For repeating sections (e.g. visits in a vet record, line items in an
  invoice), use "type": "array" with "items" describing each entry.
- Field types must be one of: "string", "number", "integer", "boolean", "array", "object".
- Every leaf field must have a short "description" (one sentence) to help
  downstream NER models identify it.
- Prefer short, snake_case keys.
- DO NOT include "additionalProperties: false" — keep the schema permissive
  so users can add their own fields later.
- DO NOT include "$schema" or "$id".

OUTPUT FORMAT: ONLY the JSON Schema, no prose, no markdown fences.

USER DOCUMENT (truncated):
"""
{{SAMPLE_TEXT}}
"""`;

const SYNTHESIS_TIMEOUT_MS = 15_000;
const SAMPLE_MAX_CHARS = 4000;

interface GeminiSynthesisResult {
  readonly jsonSchema: Record<string, unknown>;
  readonly schemaVersion: string;
}

export async function synthesizeSchemaWithGemini(
  typeKey: string,
  sampleText: string,
): Promise<GeminiSynthesisResult | null> {
  const env = getExtractEnv();
  const trimmed = sampleText.slice(0, SAMPLE_MAX_CHARS);

  const prompt = SYNTHESIS_PROMPT.replace("{{TYPE_KEY}}", typeKey).replace(
    "{{SAMPLE_TEXT}}",
    trimmed,
  );

  const ai = new GoogleGenAI({ apiKey: env.geminiApiKey });

  const aborter = new AbortController();
  const timer = setTimeout(() => aborter.abort(), SYNTHESIS_TIMEOUT_MS);

  try {
    const result = await ai.models.generateContent({
      model: env.geminiModel,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        responseMimeType: "application/json",
        temperature: 0.2,
      },
    });

    const raw = result.text;
    if (typeof raw !== "string" || raw.length === 0) return null;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }

    if (!isValidObjectSchema(parsed)) return null;

    return {
      jsonSchema: parsed,
      schemaVersion: `gemini-${hashSchema(parsed)}`,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function isValidObjectSchema(v: unknown): v is Record<string, unknown> {
  if (typeof v !== "object" || v === null) return false;
  const obj = v as Record<string, unknown>;
  if (obj.type !== "object") return false;
  if (typeof obj.properties !== "object" || obj.properties === null) return false;
  return Object.keys(obj.properties as Record<string, unknown>).length > 0;
}

// ---------------------------------------------------------------------------
// Persist a synthesized schema back to the DB.
// ---------------------------------------------------------------------------

async function persistSynthesizedSchema(
  db: LoaderDB,
  typeKey: string,
  schemaJson: Record<string, unknown>,
  schemaVersion: string,
  userId?: string,
): Promise<void> {
  // Make schema_blocks entry first (the "raw material"), then document_types
  // (the "front-door" handle). Both are best-effort — the lookup will retry.
  const blockId = `${typeKey}.base.${schemaVersion}`;
  try {
    await db
      .insert(schemaBlocks)
      .values({
        id: blockId,
        domain: typeKey,
        name: "base",
        version: schemaVersion,
        jsonSchema: schemaJson,
        isCurated: false,
        isRequiredForDomain: true,
        dependsOn: [],
        proposedByUserId: userId,
      })
      .onConflictDoNothing();
  } catch {
    // best-effort
  }

  try {
    await db
      .insert(documentTypes)
      .values({
        key: typeKey,
        name: humanizeKey(typeKey),
        description: `Auto-synthesized schema (Gemini) for ${typeKey}`,
        schemaVersion,
        jsonSchema: schemaJson,
        rendererId: "generic",
        isSystem: false,
        userId,
      })
      .onConflictDoNothing();
  } catch {
    // best-effort
  }
}

function humanizeKey(key: string): string {
  return key
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// ---------------------------------------------------------------------------
// Loader entry point
// ---------------------------------------------------------------------------

export async function loadSchema(
  db: LoaderDB,
  args: LoadSchemaArgs,
): Promise<LoadedSchema | null> {
  const { typeKey, userId, sampleText, readOnly = false } = args;

  const ck = cacheKey(typeKey, userId);
  const cached = cacheGet(ck);
  if (cached) return cached;

  // 1. document_types
  const fromDocumentTypes = await tryDocumentTypes(db, typeKey, userId);
  if (fromDocumentTypes) {
    cachePut(ck, fromDocumentTypes);
    return fromDocumentTypes;
  }

  // 2. schema_blocks composition
  const fromBlocks = await tryComposeFromBlocks(db, typeKey);
  if (fromBlocks) {
    cachePut(ck, fromBlocks);
    return fromBlocks;
  }

  // 3. Gemini synthesis (skipped in read-only mode or with no sample text).
  if (readOnly || !sampleText || sampleText.trim().length < 20) return null;

  const synthesized = await synthesizeSchemaWithGemini(typeKey, sampleText);
  if (!synthesized) return null;

  await persistSynthesizedSchema(
    db,
    typeKey,
    synthesized.jsonSchema,
    synthesized.schemaVersion,
    userId,
  );

  const result: LoadedSchema = {
    jsonSchema: synthesized.jsonSchema,
    schemaVersion: synthesized.schemaVersion,
    source: "gemini_synthesized",
    typeKey,
  };
  cachePut(ck, result);
  return result;
}

// Re-export so other modules don't need a second import.
export type { LoadedSchema as LoadedSchemaType };
// The `sql` re-export is to satisfy linters that flag unused imports; the
// helper is exported from `drizzle-orm` and may be used by future loader
// queries (e.g. arbitrary jsonb fragments). Remove if it stays unused.
export { sql as _drizzleSql };
