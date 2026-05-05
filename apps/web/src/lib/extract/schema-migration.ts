/**
 * Schema-version migration for extracted episodes.
 *
 * When a document type's schema evolves, previously folded state may no
 * longer validate under the new shape. This module performs a
 * supersession migration:
 *
 *   1. Fold every currently-valid episode (`valid_to IS NULL`) for `docId`
 *      under the OLD schema → produce a JSON snapshot.
 *   2. Run `transformFn(snapshot, fromVersion → toVersion)` to massage
 *      additive or breaking changes (default = identity for additive-only).
 *   3. Compute the RFC 6902 patch from `{}` to the transformed snapshot
 *      and append it as a NEW episode tagged with the target version.
 *   4. Mark every prior episode `valid_to = now()` and
 *      `superseded_by = newId` in the same transaction.
 *
 * The result is bi-temporally honest: history is preserved (old episodes
 * retain `valid_from`, just gain `valid_to`), and `foldCurrent` after the
 * migration returns the transformed shape under the new schema version.
 */

import { and, eq, isNull, sql } from "drizzle-orm";

import { extractionEpisodes } from "@/db/schema";
import { applyPatches, type RFC6902Patch } from "@glyph/extract";

import type { EpisodeDB } from "./episodes";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TransformFn = (
  state: unknown,
  ctx: { fromVersion: string; toVersion: string },
) => unknown;

/** Default transformer for additive-only migrations: returns state as-is. */
export const identityTransform: TransformFn = (state) => state;

export interface MigrateEpisodesArgs {
  readonly docId: string;
  readonly fromVersion: string;
  readonly toVersion: string;
  readonly transformFn?: TransformFn;
  /** SessionId to attribute the new episode to. If absent the migration
   * uses the most recent episode's session. */
  readonly sessionId?: string;
  /** UserId to write on the new row. Required if no prior episode exists. */
  readonly userId?: string;
}

export interface MigrateEpisodesResult {
  readonly newEpisodeId: string;
  readonly supersededIds: readonly string[];
  readonly fromVersion: string;
  readonly toVersion: string;
}

// ---------------------------------------------------------------------------
// JSON diff → RFC 6902
// ---------------------------------------------------------------------------

/**
 * Minimal `replace` patch: the transformed snapshot is laid down at the
 * root. This is intentional — migrations are coarse, infrequent events,
 * and a single-op replace makes supersession trivially auditable.
 *
 * Future: if granularity matters we can swap in a real `diff` (e.g. via
 * `fast-json-patch`) without changing the public surface here.
 */
function snapshotToPatch(snapshot: unknown): RFC6902Patch {
  return [{ op: "replace", path: "", value: snapshot }];
}

// ---------------------------------------------------------------------------
// migrateEpisodes
// ---------------------------------------------------------------------------

/**
 * Read-only fold for the migration: pulls every currently-valid episode
 * for `docId` ordered by `applied_at`, folds without a Zod validator
 * (we trust the patches that produced today's state).
 */
async function foldCurrentRaw(
  db: EpisodeDB,
  docId: string,
): Promise<{
  rows: Array<{ id: string; sessionId: string; userId: string; patch: unknown }>;
  state: unknown;
}> {
  const rows = (await db
    .select()
    .from(extractionEpisodes)
    .where(
      and(
        eq(extractionEpisodes.docId, docId),
        isNull(extractionEpisodes.validTo),
      ),
    )
    .orderBy(
      // type punned through to match the loose EpisodeDB shape
      sql`${extractionEpisodes.appliedAt} ASC, ${extractionEpisodes.id} ASC`,
    )) as unknown as Array<{
      id: string;
      sessionId: string;
      userId: string;
      patch: unknown;
    }>;

  let state: unknown = {};
  for (const r of rows) {
    const result = applyPatches(state, r.patch as RFC6902Patch, undefined);
    state = result.state;
  }
  return { rows, state };
}

export async function migrateEpisodes(
  db: EpisodeDB,
  args: MigrateEpisodesArgs,
): Promise<MigrateEpisodesResult> {
  if (args.fromVersion === args.toVersion) {
    throw new Error(
      `migrateEpisodes: fromVersion === toVersion (${args.fromVersion})`,
    );
  }

  const transform = args.transformFn ?? identityTransform;

  const run = async (tx: EpisodeDB): Promise<MigrateEpisodesResult> => {
    const { rows, state } = await foldCurrentRaw(tx, args.docId);

    const transformed = transform(state, {
      fromVersion: args.fromVersion,
      toVersion: args.toVersion,
    });

    const patch = snapshotToPatch(transformed);

    // Resolve sessionId/userId from the most recent prior episode if not
    // supplied — keeps the migration self-contained for one-off runs.
    const last = rows[rows.length - 1];
    const sessionId = args.sessionId ?? last?.sessionId;
    const userId = args.userId ?? last?.userId;
    if (!sessionId || !userId) {
      throw new Error(
        "migrateEpisodes: sessionId/userId required when no prior episode exists",
      );
    }

    const now = new Date();
    const inserted = await tx
      .insert(extractionEpisodes)
      .values({
        sessionId,
        docId: args.docId,
        userId,
        appliedAt: now,
        validFrom: now,
        validTo: null,
        patch: patch as unknown,
        schemaVersion: args.toVersion,
        model: "schema-migration",
        tokensIn: 0,
        tokensOut: 0,
        cachedTokens: 0,
        sourceOffsetStart: null,
        sourceOffsetEnd: null,
      })
      .returning();

    const newRow = inserted[0];
    if (!newRow) {
      throw new Error("migrateEpisodes: insert returned no row");
    }

    // Supersede every prior currently-valid row for this doc.
    const supersededIds: string[] = [];
    for (const r of rows) {
      await tx
        .update(extractionEpisodes)
        .set({ validTo: now, supersededBy: newRow.id })
        .where(eq(extractionEpisodes.id, r.id));
      supersededIds.push(r.id);
    }

    return {
      newEpisodeId: newRow.id,
      supersededIds,
      fromVersion: args.fromVersion,
      toVersion: args.toVersion,
    };
  };

  if (typeof db.transaction === "function") {
    return db.transaction(run);
  }
  return run(db);
}
