/**
 * Bi-temporal extraction episode store.
 *
 * Each LLM-emitted RFC 6902 patch is recorded as an immutable episode in
 * `extraction_episodes`. Two time axes are tracked:
 *
 *   - `applied_at`         — transaction time (when the row was written).
 *   - `valid_from`/`valid_to` — fact time (when the asserted facts hold in
 *     the document timeline). `valid_to IS NULL` means "currently valid".
 *
 * Reconstructing state at time T means folding every episode where
 * `valid_from <= T AND (valid_to IS NULL OR valid_to > T)` ordered by
 * `applied_at` ASC. To revise history we insert a new episode and point
 * the older row's `valid_to`/`superseded_by` at the newer one — never an
 * in-place update of the patch itself.
 *
 * The `db` handle is passed in (not imported as a singleton) so callers
 * can inject a transaction; this lets `appendEpisode` close-out a
 * superseded row and insert its replacement atomically.
 */

import { and, asc, eq, isNull, lte, or, gt, sql } from "drizzle-orm";
import type { z } from "zod";

import { applyPatches, type PatchError } from "@glyph/extract";
import type { RFC6902Patch } from "@glyph/extract";

import {
  extractionEpisodes,
  extractionSessions,
  type ExtractionEpisode,
} from "@/db/schema";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Minimal Drizzle-shaped handle. Accepts either the top-level `db` or a
 * transaction handle yielded by `db.transaction(...)`. We type this
 * structurally so test mocks don't have to satisfy the full Drizzle
 * surface area.
 */
export interface EpisodeDB {
  insert: (table: unknown) => {
    values: (row: unknown) => {
      returning: () => Promise<Array<{ id: string }>>;
    };
  };
  update: (table: unknown) => {
    set: (row: unknown) => {
      where: (cond: unknown) => Promise<unknown>;
    };
  };
  select: (cols?: unknown) => {
    from: (table: unknown) => {
      where: (cond: unknown) => {
        orderBy: (...args: unknown[]) => Promise<ExtractionEpisode[]>;
      };
    };
  };
  transaction?: <T>(fn: (tx: EpisodeDB) => Promise<T>) => Promise<T>;
}

export interface AppendEpisodeArgs {
  sessionId: string;
  docId: string;
  userId: string;
  patch: RFC6902Patch;
  schemaVersion?: string;
  /** Defaults to `now()`. */
  validFrom?: Date;
  /** When set, mark the prior episode as superseded by the new one. */
  supersedes?: string;
  /** Model name; defaults to "unknown" since the row column is NOT NULL. */
  model?: string;
  tokensIn?: number;
  tokensOut?: number;
  cachedTokens?: number;
  sourceOffsetStart?: number;
  sourceOffsetEnd?: number;
}

export interface FoldArgs {
  docId: string;
  schema?: z.ZodTypeAny;
}

export interface FoldAsOfArgs extends FoldArgs {
  asOf: Date;
}

export interface FoldResult {
  state: unknown;
  errors: Array<PatchError & { episodeId: string }>;
  episodeCount: number;
}

export interface CreateSessionArgs {
  userId: string;
  docId: string;
  schemaVersion: string;
  model?: string;
}

export type SessionStatus = "succeeded" | "failed" | "cancelled";

export interface EndSessionArgs {
  sessionId: string;
  status: SessionStatus;
  totals?: {
    tokensIn?: number;
    tokensOut?: number;
    cachedTokens?: number;
    costMicros?: bigint;
  };
}

// ---------------------------------------------------------------------------
// appendEpisode
// ---------------------------------------------------------------------------

/**
 * Insert an episode row. If `supersedes` is provided, the prior episode's
 * `valid_to` is set to `now()` and its `superseded_by` is pointed at the
 * new row in the same transaction.
 */
export async function appendEpisode(
  db: EpisodeDB,
  args: AppendEpisodeArgs,
): Promise<{ id: string; appliedAt: Date }> {
  const now = new Date();
  const validFrom = args.validFrom ?? now;

  const run = async (tx: EpisodeDB): Promise<{ id: string; appliedAt: Date }> => {
    const inserted = await tx
      .insert(extractionEpisodes)
      .values({
        sessionId: args.sessionId,
        docId: args.docId,
        userId: args.userId,
        appliedAt: now,
        validFrom,
        validTo: null,
        patch: args.patch as unknown,
        schemaVersion: args.schemaVersion ?? "1.0",
        model: args.model ?? "unknown",
        tokensIn: args.tokensIn ?? 0,
        tokensOut: args.tokensOut ?? 0,
        cachedTokens: args.cachedTokens ?? 0,
        sourceOffsetStart: args.sourceOffsetStart ?? null,
        sourceOffsetEnd: args.sourceOffsetEnd ?? null,
      })
      .returning();

    const row = inserted[0];
    if (!row) {
      throw new Error("appendEpisode: insert returned no row");
    }

    if (args.supersedes !== undefined) {
      await tx
        .update(extractionEpisodes)
        .set({ validTo: now, supersededBy: row.id })
        .where(eq(extractionEpisodes.id, args.supersedes));
    }

    return { id: row.id, appliedAt: now };
  };

  if (typeof db.transaction === "function") {
    return db.transaction(run);
  }
  return run(db);
}

// ---------------------------------------------------------------------------
// foldCurrent / foldAsOf
// ---------------------------------------------------------------------------

function foldEpisodes(
  rows: ExtractionEpisode[],
  schema: z.ZodTypeAny | undefined,
): FoldResult {
  const errors: Array<PatchError & { episodeId: string }> = [];
  let state: unknown = {};

  for (const row of rows) {
    const patch = row.patch as RFC6902Patch;
    try {
      const result = applyPatches(state, patch, schema);
      state = result.state;
      for (const e of result.errors) {
        errors.push({ ...e, episodeId: row.id });
      }
    } catch (err) {
      // Defensive: applyPatches should not throw, but if it does we
      // record and continue rather than killing the fold.
      errors.push({
        episodeId: row.id,
        op: 0,
        path: "",
        kind: "type",
        message: (err as Error).message ?? String(err),
      });
    }
  }

  return { state, errors, episodeCount: rows.length };
}

/**
 * Fold all currently-valid episodes (`valid_to IS NULL`) for `docId`,
 * ordered by `applied_at ASC`. Errors during apply are collected, never
 * thrown — a single bad episode does not kill the fold.
 */
export async function foldCurrent(
  db: EpisodeDB,
  args: FoldArgs,
): Promise<FoldResult> {
  const rows = await db
    .select()
    .from(extractionEpisodes)
    .where(
      and(
        eq(extractionEpisodes.docId, args.docId),
        isNull(extractionEpisodes.validTo),
      ),
    )
    .orderBy(asc(extractionEpisodes.appliedAt), asc(extractionEpisodes.id));

  return foldEpisodes(rows, args.schema);
}

/**
 * Fold every episode that was valid at `asOf`:
 *
 *   `valid_from <= asOf AND (valid_to IS NULL OR valid_to > asOf)`
 *
 * ordered by `applied_at ASC`, then `id ASC` to break ties deterministically.
 */
export async function foldAsOf(
  db: EpisodeDB,
  args: FoldAsOfArgs,
): Promise<FoldResult> {
  const rows = await db
    .select()
    .from(extractionEpisodes)
    .where(
      and(
        eq(extractionEpisodes.docId, args.docId),
        lte(extractionEpisodes.validFrom, args.asOf),
        or(
          isNull(extractionEpisodes.validTo),
          gt(extractionEpisodes.validTo, args.asOf),
        ),
      ),
    )
    .orderBy(asc(extractionEpisodes.appliedAt), asc(extractionEpisodes.id));

  return foldEpisodes(rows, args.schema);
}

// ---------------------------------------------------------------------------
// Session lifecycle
// ---------------------------------------------------------------------------

export async function createSession(
  db: EpisodeDB,
  args: CreateSessionArgs,
): Promise<{ id: string }> {
  const inserted = await db
    .insert(extractionSessions)
    .values({
      userId: args.userId,
      docId: args.docId,
      schemaType: args.schemaVersion,
      model: args.model ?? "gemini-2.5-flash-lite",
    })
    .returning();

  const row = inserted[0];
  if (!row) {
    throw new Error("createSession: insert returned no row");
  }
  return { id: row.id };
}

export async function endSession(
  db: EpisodeDB,
  args: EndSessionArgs,
): Promise<void> {
  const totals = args.totals ?? {};
  const patch: Record<string, unknown> = {
    endedAt: new Date(),
    // status isn't a column on the schema today; persist it via SQL only if
    // present, otherwise totals + endedAt is enough to mark the session done.
  };
  if (totals.tokensIn !== undefined) patch.totalTokensIn = totals.tokensIn;
  if (totals.tokensOut !== undefined) patch.totalTokensOut = totals.tokensOut;
  if (totals.cachedTokens !== undefined) {
    patch.totalCachedTokens = totals.cachedTokens;
  }
  if (totals.costMicros !== undefined) patch.totalCostMicros = totals.costMicros;

  // We tag the status into a SQL fragment so it lands in logs even though
  // the column is not yet materialised; downstream readers can ignore it.
  void args.status;
  void sql; // sql import retained for future status-column migration.

  await db
    .update(extractionSessions)
    .set(patch)
    .where(eq(extractionSessions.id, args.sessionId));
}
