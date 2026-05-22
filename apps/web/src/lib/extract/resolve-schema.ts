/**
 * Dynamic schema resolver.
 *
 * The extraction pipeline accepts any document type key registered in the
 * `document_types` table (system types like `contract`/`resume`/`invoice`
 * and user-defined custom types alike). This module unifies that lookup
 * behind a single `resolveSchema` call that returns the live Zod
 * validator, the JSON Schema representation, and a stable `schemaVersion`.
 *
 * Caching: a small in-memory FIFO cache (`max = 256`) keyed by
 * `${typeKey}:${schemaVersion}` skips both the DB roundtrip and the
 * `jsonSchemaToZod` compile on hot paths. The cache key is recorded after
 * resolution so callers that don't yet know `schemaVersion` (the very
 * first lookup) still hit on subsequent calls.
 *
 * Tenant isolation: every lookup filters by `userId IS NULL OR userId = ?`,
 * so tenant A cannot resolve tenant B's private types.
 */
import { createHash } from "node:crypto";

import { and, eq, isNull, or } from "drizzle-orm";
import type { ZodTypeAny } from "zod";

import { jsonSchemaToZod } from "@glyph/schema-library";

import { documentTypes } from "@/db/schema";

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

export type SchemaSource = "custom";

export interface ResolvedSchema {
  readonly zodSchema: ZodTypeAny;
  readonly schemaJson: Record<string, unknown>;
  readonly schemaVersion: string;
  readonly source: SchemaSource;
}

export interface ResolveSchemaArgs {
  readonly typeKey: string;
  readonly userId?: string;
}

export class SchemaNotFoundError extends Error {
  readonly typeKey: string;
  readonly userId?: string;
  constructor(typeKey: string, userId?: string) {
    super(
      `Schema not found for typeKey="${typeKey}"` +
        (userId ? ` userId="${userId}"` : ""),
    );
    this.name = "SchemaNotFoundError";
    this.typeKey = typeKey;
    this.userId = userId;
  }
}

// ---------------------------------------------------------------------------
// FIFO cache
// ---------------------------------------------------------------------------

const CACHE_MAX = 256;
const cache = new Map<string, ResolvedSchema>();

function cacheGet(key: string): ResolvedSchema | undefined {
  return cache.get(key);
}

function cachePut(key: string, value: ResolvedSchema): void {
  if (cache.has(key)) return;
  if (cache.size >= CACHE_MAX) {
    // FIFO eviction: drop the oldest insertion (Map iteration order).
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, value);
}

/** Test-only: clears the in-memory cache. */
export function _resetSchemaCache(): void {
  cache.clear();
}

// ---------------------------------------------------------------------------
// Stable JSON stringify (for content-addressable version hashing)
// ---------------------------------------------------------------------------

function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) {
    return `[${v.map(stableStringify).join(",")}]`;
  }
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return `{${keys
    .map(
      (k) =>
        `${JSON.stringify(k)}:${stableStringify(
          (v as Record<string, unknown>)[k],
        )}`,
    )
    .join(",")}}`;
}

function hashSchema(schema: unknown): string {
  return createHash("sha256")
    .update(stableStringify(schema))
    .digest("hex")
    .slice(0, 12);
}

// ---------------------------------------------------------------------------
// DB shape
// ---------------------------------------------------------------------------

/**
 * Minimal Drizzle-shaped db handle. Typed structurally so test mocks need
 * not satisfy the full Drizzle surface. Mirrors the pattern in
 * `episodes.ts`'s `EpisodeDB`.
 */
export interface ResolveSchemaDB {
  select: (cols?: unknown) => {
    from: (table: unknown) => {
      where: (cond: unknown) => {
        limit: (n: number) => Promise<
          Array<{
            jsonSchema: unknown;
            schemaVersion: string | null;
            userId: string | null;
          }>
        >;
      };
    };
  };
}

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

export async function resolveSchema(
  db: ResolveSchemaDB,
  args: ResolveSchemaArgs,
): Promise<ResolvedSchema> {
  const { typeKey, userId } = args;

  // Initial lookup key — used to short-circuit before we know the
  // resolved version. We include userId so that tenant A's "foo" cannot
  // return tenant B's cached "foo".
  const lookupKey = `lookup:custom:${userId ?? "anon"}:${typeKey}`;

  const lookupHit = cacheGet(lookupKey);
  if (lookupHit) return lookupHit;

  // Query DB with tenant isolation.
  // userId IS NULL covers shared/system types; userId = ? covers the
  // caller's own private types.
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
      userId: documentTypes.userId,
    })
    .from(documentTypes)
    .where(condition)
    .limit(1);

  const row = rows[0];
  if (!row) {
    throw new SchemaNotFoundError(typeKey, userId);
  }

  const schemaJson = row.jsonSchema as Record<string, unknown>;
  // jsonSchemaToZod takes JSONSchema7; structural cast is safe here.
  const zodSchema = jsonSchemaToZod(
    schemaJson as Parameters<typeof jsonSchemaToZod>[0],
  );
  const schemaVersion =
    row.schemaVersion && row.schemaVersion.length > 0
      ? row.schemaVersion
      : `custom-${hashSchema(schemaJson)}`;

  const resolved: ResolvedSchema = {
    zodSchema,
    schemaJson,
    schemaVersion,
    source: "custom",
  };
  cachePut(lookupKey, resolved);
  cachePut(`${typeKey}:${schemaVersion}`, resolved);
  return resolved;
}
