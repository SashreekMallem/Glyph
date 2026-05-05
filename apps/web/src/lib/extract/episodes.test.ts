/**
 * Unit tests for the bi-temporal extraction episode store.
 *
 * The db is fully mocked: an in-memory `MockDB` records every insert /
 * update and answers `select(...).from(...).where(...).orderBy(...)`
 * by ignoring the predicate object and returning rows the test seeded.
 * This keeps tests fast and free of Postgres dependency, at the cost of
 * not exercising the real WHERE clauses — those are covered by the
 * integration test in `episodes.integration.test.ts`.
 */

import { describe, it, expect, beforeEach } from "vitest";

import {
  appendEpisode,
  foldCurrent,
  foldAsOf,
  createSession,
  endSession,
  type EpisodeDB,
} from "./episodes";
import type { ExtractionEpisode } from "@/db/schema";

// ---------------------------------------------------------------------------
// Mock db
// ---------------------------------------------------------------------------

interface InsertCall {
  table: unknown;
  values: Record<string, unknown>;
}

interface UpdateCall {
  table: unknown;
  set: Record<string, unknown>;
  where: unknown;
}

class MockDB implements EpisodeDB {
  inserts: InsertCall[] = [];
  updates: UpdateCall[] = [];
  /** Rows returned by the next `.select().from().where().orderBy()` call. */
  selectRows: ExtractionEpisode[] = [];
  /** ID generator for inserted rows. */
  private nextId = 1;
  /** Returned-from-insert rows the test wants to inspect. */
  insertReturnIds: string[] = [];

  insert(table: unknown) {
    return {
      values: (row: unknown) => {
        const id = `row-${this.nextId++}`;
        this.inserts.push({ table, values: row as Record<string, unknown> });
        this.insertReturnIds.push(id);
        return {
          returning: async () => [{ id }],
        };
      },
    };
  }

  update(table: unknown) {
    return {
      set: (row: unknown) => ({
        where: async (cond: unknown) => {
          this.updates.push({ table, set: row as Record<string, unknown>, where: cond });
        },
      }),
    };
  }

  select(_cols?: unknown) {
    const rows = this.selectRows;
    return {
      from: (_table: unknown) => ({
        where: (_cond: unknown) => ({
          orderBy: async (..._args: unknown[]) => rows,
        }),
      }),
    };
  }

  async transaction<T>(fn: (tx: EpisodeDB) => Promise<T>): Promise<T> {
    return fn(this);
  }
}

function makeEpisode(
  partial: Partial<ExtractionEpisode> & {
    id: string;
    docId: string;
    appliedAt: Date;
    validFrom: Date;
    patch: unknown;
  },
): ExtractionEpisode {
  return {
    id: partial.id,
    docId: partial.docId,
    userId: partial.userId ?? "user-1",
    sessionId: partial.sessionId ?? "session-1",
    appliedAt: partial.appliedAt,
    validFrom: partial.validFrom,
    validTo: partial.validTo ?? null,
    patch: partial.patch,
    sourceOffsetStart: partial.sourceOffsetStart ?? null,
    sourceOffsetEnd: partial.sourceOffsetEnd ?? null,
    model: partial.model ?? "test",
    tokensIn: partial.tokensIn ?? 0,
    tokensOut: partial.tokensOut ?? 0,
    cachedTokens: partial.cachedTokens ?? 0,
    supersededBy: partial.supersededBy ?? null,
    schemaVersion: partial.schemaVersion ?? "1.0",
  } as ExtractionEpisode;
}

// ---------------------------------------------------------------------------
// appendEpisode
// ---------------------------------------------------------------------------

describe("appendEpisode", () => {
  let db: MockDB;
  beforeEach(() => {
    db = new MockDB();
  });

  it("writes a row with applied_at = valid_from = now() when no validFrom passed", async () => {
    const before = new Date();
    const result = await appendEpisode(db, {
      sessionId: "s1",
      docId: "d1",
      userId: "u1",
      patch: [{ op: "add", path: "/title", value: "X" }],
      schemaVersion: "1.0",
    });
    const after = new Date();

    expect(result.id).toBe("row-1");
    expect(db.inserts).toHaveLength(1);
    expect(db.updates).toHaveLength(0);

    const row = db.inserts[0]!.values;
    expect(row.sessionId).toBe("s1");
    expect(row.docId).toBe("d1");
    expect(row.userId).toBe("u1");
    expect(row.validTo).toBeNull();
    expect(row.schemaVersion).toBe("1.0");

    const applied = row.appliedAt as Date;
    const validFrom = row.validFrom as Date;
    expect(applied.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(applied.getTime()).toBeLessThanOrEqual(after.getTime());
    expect(validFrom.getTime()).toBe(applied.getTime());
  });

  it("respects an explicit validFrom", async () => {
    const validFrom = new Date("2024-01-15T00:00:00Z");
    await appendEpisode(db, {
      sessionId: "s1",
      docId: "d1",
      userId: "u1",
      patch: [],
      validFrom,
    });

    const row = db.inserts[0]!.values;
    expect((row.validFrom as Date).toISOString()).toBe(validFrom.toISOString());
    expect((row.appliedAt as Date).toISOString()).not.toBe(
      validFrom.toISOString(),
    );
  });

  it("supersedes a prior episode by closing its valid_to and pointing superseded_by", async () => {
    const result = await appendEpisode(db, {
      sessionId: "s1",
      docId: "d1",
      userId: "u1",
      patch: [{ op: "replace", path: "/title", value: "Y" }],
      supersedes: "old-episode-id",
    });

    expect(db.inserts).toHaveLength(1);
    expect(db.updates).toHaveLength(1);

    const upd = db.updates[0]!;
    expect(upd.set.supersededBy).toBe(result.id);
    expect(upd.set.validTo).toBeInstanceOf(Date);
  });
});

// ---------------------------------------------------------------------------
// foldCurrent
// ---------------------------------------------------------------------------

describe("foldCurrent", () => {
  let db: MockDB;
  beforeEach(() => {
    db = new MockDB();
  });

  it("applies patches in applied_at order", async () => {
    // The mock returns rows verbatim — we put them in applied_at order.
    db.selectRows = [
      makeEpisode({
        id: "e1",
        docId: "d1",
        appliedAt: new Date("2024-01-01T00:00:00Z"),
        validFrom: new Date("2024-01-01T00:00:00Z"),
        patch: [{ op: "add", path: "/title", value: "first" }],
      }),
      makeEpisode({
        id: "e2",
        docId: "d1",
        appliedAt: new Date("2024-01-02T00:00:00Z"),
        validFrom: new Date("2024-01-02T00:00:00Z"),
        patch: [{ op: "replace", path: "/title", value: "second" }],
      }),
    ];

    const result = await foldCurrent(db, { docId: "d1" });
    expect(result.episodeCount).toBe(2);
    expect(result.errors).toHaveLength(0);
    expect((result.state as Record<string, unknown>).title).toBe("second");
  });

  it("ignores rows the query already filtered (mocked) — sanity check on empty fold", async () => {
    db.selectRows = []; // simulating WHERE valid_to IS NULL filtering everything
    const result = await foldCurrent(db, { docId: "d1" });
    expect(result.episodeCount).toBe(0);
    expect(result.state).toEqual({});
  });

  it("collects errors when a patch is malformed but keeps going", async () => {
    db.selectRows = [
      makeEpisode({
        id: "e1",
        docId: "d1",
        appliedAt: new Date(1000),
        validFrom: new Date(1000),
        patch: [{ op: "add", path: "/title", value: "ok" }],
      }),
      makeEpisode({
        id: "e2-bad",
        docId: "d1",
        appliedAt: new Date(2000),
        validFrom: new Date(2000),
        // bad path: cannot index into a string
        patch: [{ op: "add", path: "/title/x", value: "fail" }],
      }),
      makeEpisode({
        id: "e3",
        docId: "d1",
        appliedAt: new Date(3000),
        validFrom: new Date(3000),
        patch: [{ op: "add", path: "/note", value: "after-bad" }],
      }),
    ];

    const result = await foldCurrent(db, { docId: "d1" });
    expect(result.episodeCount).toBe(3);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]!.episodeId).toBe("e2-bad");
    // First and third episodes still applied despite middle failure.
    const state = result.state as Record<string, unknown>;
    expect(state.title).toBe("ok");
    expect(state.note).toBe("after-bad");
  });
});

// ---------------------------------------------------------------------------
// foldAsOf
// ---------------------------------------------------------------------------

describe("foldAsOf", () => {
  let db: MockDB;
  beforeEach(() => {
    db = new MockDB();
  });

  it("returns historical state by folding rows the query selected", async () => {
    // Caller asks for asOf = 2024-01-15. We seed the rows that would
    // have been selected — mock doesn't itself enforce WHERE.
    db.selectRows = [
      makeEpisode({
        id: "e1",
        docId: "d1",
        appliedAt: new Date("2024-01-10T00:00:00Z"),
        validFrom: new Date("2024-01-10T00:00:00Z"),
        validTo: new Date("2024-01-20T00:00:00Z"),
        patch: [{ op: "add", path: "/title", value: "v1" }],
      }),
    ];
    const result = await foldAsOf(db, {
      docId: "d1",
      asOf: new Date("2024-01-15T00:00:00Z"),
    });
    expect(result.episodeCount).toBe(1);
    expect((result.state as Record<string, unknown>).title).toBe("v1");
  });

  it("excludes future episodes (valid_from > asOf) — empty fold", async () => {
    // The real query would filter these out via valid_from <= asOf;
    // we simulate that by returning an empty row set for the asOf query.
    db.selectRows = [];
    const result = await foldAsOf(db, {
      docId: "d1",
      asOf: new Date("2024-01-15T00:00:00Z"),
    });
    expect(result.episodeCount).toBe(0);
    expect(result.state).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// Session lifecycle
// ---------------------------------------------------------------------------

describe("session lifecycle", () => {
  it("createSession inserts and returns id; endSession updates with totals", async () => {
    const db = new MockDB();
    const created = await createSession(db, {
      userId: "u1",
      docId: "d1",
      schemaVersion: "contract@1.0",
    });
    expect(created.id).toBe("row-1");
    expect(db.inserts).toHaveLength(1);
    expect(db.inserts[0]!.values).toMatchObject({
      userId: "u1",
      docId: "d1",
      schemaType: "contract@1.0",
    });

    await endSession(db, {
      sessionId: created.id,
      status: "succeeded",
      totals: {
        tokensIn: 100,
        tokensOut: 50,
        cachedTokens: 10,
        costMicros: 12345n,
      },
    });

    expect(db.updates).toHaveLength(1);
    const setRow = db.updates[0]!.set;
    expect(setRow.endedAt).toBeInstanceOf(Date);
    expect(setRow.totalTokensIn).toBe(100);
    expect(setRow.totalTokensOut).toBe(50);
    expect(setRow.totalCachedTokens).toBe(10);
    expect(setRow.totalCostMicros).toBe(12345n);
  });
});
