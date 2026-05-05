/**
 * Adaptive-schema composition resolver.
 *
 * The runtime hot path: given a list of `schema_blocks.id`s, return the
 * merged JSON Schema (and a Zod validator) representing the document
 * shape to validate against. Compositions are cached by a deterministic
 * fingerprint so identical block-sets across users share one compiled
 * schema — once cached, the merged schema is never recomputed.
 */

import { createHash } from "node:crypto";
import { and, eq, inArray, sql as dsql } from "drizzle-orm";
import { jsonSchemaToZod } from "@glyph/schema-library";
import type { ZodTypeAny } from "zod";
import { db } from "@/db";
import { schemaBlocks, schemaCompositions } from "@/db/schema";

type JsonSchemaInput = Parameters<typeof jsonSchemaToZod>[0];

export interface ComposedSchema {
  readonly compositionId: string;
  readonly domain: string;
  readonly blockIds: readonly string[];
  readonly fingerprint: string;
  readonly jsonSchema: Record<string, unknown>;
  readonly zod: ZodTypeAny;
}

/** Sorted-then-hashed fingerprint of a block id list. */
export function fingerprintBlocks(blockIds: readonly string[]): string {
  const sorted = [...blockIds].sort();
  return createHash("sha256").update(sorted.join(":")).digest("hex");
}

/**
 * Merge an array of JSON Schema fragments into a single object schema.
 *  - properties: shallow-merge (later block wins on key collision).
 *  - required: union (deduplicated, sorted).
 *  - type: "object" enforced.
 *  - Throws if any block isn't a plain object schema.
 */
export function mergeBlocks(
  fragments: readonly Record<string, unknown>[],
): Record<string, unknown> {
  const merged: {
    type: "object";
    properties: Record<string, unknown>;
    required: string[];
  } = {
    type: "object",
    properties: {},
    required: [],
  };
  const reqSet = new Set<string>();
  for (const f of fragments) {
    if (f.type !== "object") {
      throw new Error(`Block must be type:"object", got ${String(f.type)}`);
    }
    const props = (f.properties ?? {}) as Record<string, unknown>;
    for (const [k, v] of Object.entries(props)) merged.properties[k] = v;
    const req = (f.required ?? []) as string[];
    for (const r of req) reqSet.add(r);
  }
  merged.required = [...reqSet].sort();
  return merged;
}

/**
 * Resolve a composition: cache hit -> return; miss -> compose, store, return.
 * Race-safe via Postgres ON CONFLICT on the unique `fingerprint` index.
 */
export async function resolveComposition(args: {
  readonly domain: string;
  readonly blockIds: readonly string[];
  readonly userId?: string;
}): Promise<ComposedSchema> {
  const sortedIds = [...args.blockIds].sort();
  const fingerprint = fingerprintBlocks(sortedIds);

  // Fast path: cache hit.
  const [hit] = await db
    .select()
    .from(schemaCompositions)
    .where(eq(schemaCompositions.fingerprint, fingerprint))
    .limit(1);

  if (hit) {
    // Best-effort reuse counter bump.
    await db
      .update(schemaCompositions)
      .set({ reuseCount: dsql`${schemaCompositions.reuseCount} + 1` })
      .where(eq(schemaCompositions.id, hit.id));
    const compiled = hit.compiledJsonSchema as Record<string, unknown>;
    return {
      compositionId: hit.id,
      domain: hit.domain,
      blockIds: hit.blockIds,
      fingerprint: hit.fingerprint,
      jsonSchema: compiled,
      zod: jsonSchemaToZod(compiled as unknown as JsonSchemaInput),
    };
  }

  // Cold path: fetch blocks, merge deterministically, store.
  const blocks = await db
    .select()
    .from(schemaBlocks)
    .where(inArray(schemaBlocks.id, sortedIds));
  if (blocks.length !== sortedIds.length) {
    const found = new Set(blocks.map((b) => b.id));
    const missing = sortedIds.filter((id) => !found.has(id));
    throw new Error(`Unknown blocks: ${missing.join(", ")}`);
  }
  blocks.sort((a, b) => a.id.localeCompare(b.id));
  const fragments = blocks.map((b) => b.jsonSchema as Record<string, unknown>);
  const compiled = mergeBlocks(fragments);

  // Race-safe insert. If a parallel request beat us, the ON CONFLICT
  // path bumps reuseCount and RETURNING yields the existing row.
  const inserted = await db
    .insert(schemaCompositions)
    .values({
      domain: args.domain,
      blockIds: sortedIds,
      fingerprint,
      compiledJsonSchema: compiled,
      firstSeenUserId: args.userId ?? null,
    })
    .onConflictDoUpdate({
      target: schemaCompositions.fingerprint,
      set: { reuseCount: dsql`${schemaCompositions.reuseCount} + 1` },
    })
    .returning();

  const row = inserted[0]!;
  return {
    compositionId: row.id,
    domain: row.domain,
    blockIds: row.blockIds,
    fingerprint: row.fingerprint,
    jsonSchema: compiled,
    zod: jsonSchemaToZod(compiled as unknown as JsonSchemaInput),
  };
}

/**
 * Discover what blocks are available for a domain. Used by the
 * `discover_schema` MCP tool so AI agents can pick blocks intelligently.
 */
export async function listBlocksForDomain(domain: string): Promise<
  Array<{
    id: string;
    name: string;
    version: string;
    isRequired: boolean;
    jsonSchema: unknown;
  }>
> {
  const rows = await db
    .select({
      id: schemaBlocks.id,
      name: schemaBlocks.name,
      version: schemaBlocks.version,
      isRequired: schemaBlocks.isRequiredForDomain,
      jsonSchema: schemaBlocks.jsonSchema,
    })
    .from(schemaBlocks)
    .where(eq(schemaBlocks.domain, domain));
  return rows;
}

/**
 * Load a previously-resolved composition by id. Returns `null` if
 * the row doesn't exist (e.g. it was reaped). Used by save/finalize
 * paths that previously persisted a `compositionId` to a document row
 * and need to revive the matching schema.
 */
export async function loadComposition(
  compositionId: string,
): Promise<ComposedSchema | null> {
  const [row] = await db
    .select()
    .from(schemaCompositions)
    .where(eq(schemaCompositions.id, compositionId))
    .limit(1);
  if (!row) return null;
  const compiled = row.compiledJsonSchema as Record<string, unknown>;
  return {
    compositionId: row.id,
    domain: row.domain,
    blockIds: row.blockIds,
    fingerprint: row.fingerprint,
    jsonSchema: compiled,
    zod: jsonSchemaToZod(compiled as unknown as JsonSchemaInput),
  };
}

/**
 * Get the default required-blocks composition for a domain. Used when
 * an AI agent passes only `document_type` without explicit blocks.
 */
export async function defaultCompositionForDomain(
  domain: string,
  userId?: string,
): Promise<ComposedSchema> {
  const rows = await db
    .select({ id: schemaBlocks.id })
    .from(schemaBlocks)
    .where(
      and(
        eq(schemaBlocks.domain, domain),
        eq(schemaBlocks.isRequiredForDomain, true),
      ),
    );
  const ids = rows.map((r) => r.id);
  if (ids.length === 0) {
    throw new Error(`No required blocks registered for domain "${domain}"`);
  }
  return resolveComposition({ domain, blockIds: ids, userId });
}
