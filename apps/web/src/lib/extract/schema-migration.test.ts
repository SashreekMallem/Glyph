/**
 * schema-migration unit tests.
 *
 * MockDB is a tiny in-memory analogue of the episodes table that records
 * inserts, updates, and answers selects with a stable ordered list.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

import { migrateEpisodes, identityTransform } from "./schema-migration";
import type { EpisodeDB } from "./episodes";

vi.mock("@/db/schema", () => ({
  extractionEpisodes: {
    id: { name: "id" },
    docId: { name: "doc_id" },
    appliedAt: { name: "applied_at" },
    validTo: { name: "valid_to" },
  },
}));

vi.mock("drizzle-orm", () => ({
  and: (...a: unknown[]) => ({ _op: "and", a }),
  eq: (a: unknown, b: unknown) => ({ _op: "eq", a, b }),
  isNull: (a: unknown) => ({ _op: "isNull", a }),
  sql: Object.assign(
    (strings: TemplateStringsArray, ...vals: unknown[]) => ({
      _op: "sql",
      strings,
      vals,
    }),
    { raw: (s: string) => ({ _op: "sql_raw", s }) },
  ),
}));

interface Episode {
  id: string;
  sessionId: string;
  userId: string;
  patch: unknown;
  validTo: Date | null;
  supersededBy: string | null;
  appliedAt: Date;
  schemaVersion?: string;
}

class MockDB {
  rows: Episode[] = [];
  inserts: Episode[] = [];
  updates: Array<{ id: string; set: Record<string, unknown> }> = [];
  nextId = 100;

  insert(_t: unknown) {
    return {
      values: (row: Record<string, unknown>) => ({
        returning: async () => {
          const id = `ep-${this.nextId++}`;
          const inserted: Episode = {
            id,
            sessionId: String(row.sessionId),
            userId: String(row.userId),
            patch: row.patch,
            validTo: (row.validTo as Date | null) ?? null,
            supersededBy: null,
            appliedAt: (row.appliedAt as Date) ?? new Date(),
            schemaVersion: row.schemaVersion as string | undefined,
          };
          this.rows.push(inserted);
          this.inserts.push(inserted);
          return [{ id }];
        },
      }),
    };
  }

  update(_t: unknown) {
    return {
      set: (row: Record<string, unknown>) => ({
        where: async (cond: { _op: string; a: unknown; b: unknown }) => {
          // Cond is { _op: 'eq', a: id-col, b: 'ep-x' } from our drizzle mock.
          const id = (cond?.b as string) ?? null;
          const target = this.rows.find((r) => r.id === id);
          if (target) {
            if (row.validTo !== undefined) target.validTo = row.validTo as Date | null;
            if (row.supersededBy !== undefined) {
              target.supersededBy = row.supersededBy as string;
            }
            this.updates.push({ id, set: row });
          }
          return undefined;
        },
      }),
    };
  }

  select(_cols?: unknown) {
    return {
      from: (_t: unknown) => ({
        where: (_cond: unknown) => ({
          orderBy: async (..._args: unknown[]) =>
            this.rows
              .filter((r) => r.validTo === null)
              .sort((a, b) => a.appliedAt.getTime() - b.appliedAt.getTime())
              .map((r) => ({ ...r })),
        }),
      }),
    };
  }
}

function seedEpisode(
  db: MockDB,
  patch: unknown,
  appliedAt: Date,
  id: string,
  sessionId = "sess-1",
  userId = "user-1",
): void {
  db.rows.push({
    id,
    sessionId,
    userId,
    patch,
    validTo: null,
    supersededBy: null,
    appliedAt,
  });
}

describe("migrateEpisodes", () => {
  let db: MockDB;
  beforeEach(() => {
    db = new MockDB();
  });

  it("supersedes all prior episodes and writes one new row at toVersion", async () => {
    const t0 = new Date("2026-01-01T00:00:00Z");
    const t1 = new Date("2026-01-02T00:00:00Z");
    seedEpisode(
      db,
      [{ op: "add", path: "/title", value: "Hello" }],
      t0,
      "ep-1",
    );
    seedEpisode(
      db,
      [{ op: "add", path: "/year", value: 2026 }],
      t1,
      "ep-2",
    );

    const res = await migrateEpisodes(db as unknown as EpisodeDB, {
      docId: "doc-1",
      fromVersion: "v1",
      toVersion: "v2",
    });

    expect(res.newEpisodeId).toMatch(/^ep-\d+$/);
    expect([...res.supersededIds].sort()).toEqual(["ep-1", "ep-2"]);
    expect(res.fromVersion).toBe("v1");
    expect(res.toVersion).toBe("v2");

    // Both old rows now have validTo set.
    const ep1 = db.rows.find((r) => r.id === "ep-1")!;
    const ep2 = db.rows.find((r) => r.id === "ep-2")!;
    expect(ep1.validTo).toBeInstanceOf(Date);
    expect(ep2.validTo).toBeInstanceOf(Date);
    expect(ep1.supersededBy).toBe(res.newEpisodeId);
    expect(ep2.supersededBy).toBe(res.newEpisodeId);

    // Insert carries the new schema version.
    expect(db.inserts).toHaveLength(1);
    expect(db.inserts[0]!.schemaVersion).toBe("v2");
  });

  it("identity transform round-trips folded state", async () => {
    seedEpisode(
      db,
      [{ op: "add", path: "/a", value: 1 }],
      new Date("2026-01-01"),
      "ep-1",
    );
    const res = await migrateEpisodes(db as unknown as EpisodeDB, {
      docId: "doc-1",
      fromVersion: "v1",
      toVersion: "v2",
      transformFn: identityTransform,
    });
    const newRow = db.rows.find((r) => r.id === res.newEpisodeId)!;
    const patch = newRow.patch as Array<{ op: string; path: string; value: unknown }>;
    expect(patch).toHaveLength(1);
    expect(patch[0]!.op).toBe("replace");
    expect(patch[0]!.value).toEqual({ a: 1 });
  });

  it("applies a custom transform before writing", async () => {
    seedEpisode(
      db,
      [{ op: "add", path: "/name", value: "Alice" }],
      new Date("2026-01-01"),
      "ep-1",
    );
    const transform = (state: unknown) => {
      const s = state as { name: string };
      return { fullName: s.name, version: 2 };
    };
    const res = await migrateEpisodes(db as unknown as EpisodeDB, {
      docId: "doc-1",
      fromVersion: "v1",
      toVersion: "v2",
      transformFn: transform,
    });
    const newRow = db.rows.find((r) => r.id === res.newEpisodeId)!;
    const patch = newRow.patch as Array<{ value: unknown }>;
    expect(patch[0]!.value).toEqual({ fullName: "Alice", version: 2 });
  });

  it("rejects no-op fromVersion === toVersion", async () => {
    await expect(
      migrateEpisodes(db as unknown as EpisodeDB, {
        docId: "doc-1",
        fromVersion: "v1",
        toVersion: "v1",
      }),
    ).rejects.toThrow(/fromVersion === toVersion/);
  });

  it("requires explicit sessionId/userId when no prior episodes exist", async () => {
    await expect(
      migrateEpisodes(db as unknown as EpisodeDB, {
        docId: "empty-doc",
        fromVersion: "v1",
        toVersion: "v2",
      }),
    ).rejects.toThrow(/sessionId\/userId required/);
  });

  it("uses supplied sessionId/userId when no prior episodes exist", async () => {
    const res = await migrateEpisodes(db as unknown as EpisodeDB, {
      docId: "empty-doc",
      fromVersion: "v1",
      toVersion: "v2",
      sessionId: "sess-fresh",
      userId: "user-fresh",
    });
    const newRow = db.rows.find((r) => r.id === res.newEpisodeId)!;
    expect(newRow.sessionId).toBe("sess-fresh");
    expect(newRow.userId).toBe("user-fresh");
  });
});
