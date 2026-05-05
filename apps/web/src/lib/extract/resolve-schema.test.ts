/**
 * Tests for the dynamic schema resolver.
 *
 * The DB is fully mocked in the same spirit as `episodes.test.ts`: a
 * MockDB returns rows the test seeded and ignores the predicate object.
 * We verify the resolver hits the DB only when needed and respects
 * tenant isolation by tracking how many times `select` was invoked.
 */

import { describe, it, expect, beforeEach } from "vitest";

import {
  resolveSchema,
  SchemaNotFoundError,
  _resetSchemaCache,
  type ResolveSchemaDB,
} from "./resolve-schema";

interface CustomTypeRow {
  jsonSchema: unknown;
  schemaVersion: string | null;
  userId: string | null;
}

class MockDB implements ResolveSchemaDB {
  selectCalls = 0;
  /** Map keyed by `${userId ?? "null"}:${typeKey}` of row to return. */
  rowsByOwnerKey = new Map<string, CustomTypeRow>();
  /** Last lookup we'll honour; the test stages this. */
  nextRow: CustomTypeRow | null = null;

  select(_cols?: unknown) {
    this.selectCalls++;
    const row = this.nextRow;
    return {
      from: (_table: unknown) => ({
        where: (_cond: unknown) => ({
          limit: async (_n: number) => (row ? [row] : []),
        }),
      }),
    };
  }
}

beforeEach(() => {
  _resetSchemaCache();
});

describe("resolveSchema — built-ins", () => {
  it.each(["contract", "resume", "invoice"] as const)(
    "resolves built-in %s without touching the DB",
    async (typeKey) => {
      const db = new MockDB();
      const out = await resolveSchema(db, { typeKey, userId: "u1" });
      expect(out.source).toBe("builtin");
      expect(out.schemaVersion).toBe(`builtin-v1-${typeKey}`);
      expect(out.zodSchema).toBeDefined();
      expect(out.schemaJson).toBeDefined();
      expect(typeof out.schemaJson).toBe("object");
      expect(db.selectCalls).toBe(0);
    },
  );

  it("returns a usable Zod validator for built-ins", async () => {
    const db = new MockDB();
    const out = await resolveSchema(db, { typeKey: "resume", userId: "u1" });
    const result = out.zodSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe("resolveSchema — custom types", () => {
  it("queries DB, compiles JSON Schema to Zod, returns usable validator", async () => {
    const db = new MockDB();
    db.nextRow = {
      jsonSchema: {
        type: "object",
        properties: {
          title: { type: "string" },
          count: { type: "integer", minimum: 0 },
        },
        required: ["title"],
      },
      schemaVersion: "2.3",
      userId: "u1",
    };

    const out = await resolveSchema(db, {
      typeKey: "purchase_order",
      userId: "u1",
    });
    expect(out.source).toBe("custom");
    expect(out.schemaVersion).toBe("2.3");
    expect(db.selectCalls).toBe(1);

    const ok = out.zodSchema.safeParse({ title: "PO-1", count: 3 });
    expect(ok.success).toBe(true);
    const bad = out.zodSchema.safeParse({ count: -1 });
    expect(bad.success).toBe(false);
  });

  it("falls back to content hash when DB row has no schema_version", async () => {
    const db = new MockDB();
    db.nextRow = {
      jsonSchema: { type: "object", properties: { x: { type: "string" } } },
      schemaVersion: "",
      userId: null,
    };
    const out = await resolveSchema(db, { typeKey: "shared_thing" });
    expect(out.schemaVersion).toMatch(/^custom-[0-9a-f]{12}$/);
  });

  it("throws SchemaNotFoundError when neither built-in nor DB hit", async () => {
    const db = new MockDB();
    db.nextRow = null;
    await expect(
      resolveSchema(db, { typeKey: "no_such_type", userId: "u1" }),
    ).rejects.toBeInstanceOf(SchemaNotFoundError);
  });
});

describe("resolveSchema — caching", () => {
  it("memoizes built-ins (zero DB hits ever)", async () => {
    const db = new MockDB();
    await resolveSchema(db, { typeKey: "invoice" });
    await resolveSchema(db, { typeKey: "invoice" });
    expect(db.selectCalls).toBe(0);
  });

  it("memoizes custom types — second call doesn't hit DB", async () => {
    const db = new MockDB();
    db.nextRow = {
      jsonSchema: { type: "object", properties: { a: { type: "string" } } },
      schemaVersion: "1.0",
      userId: "u1",
    };
    const first = await resolveSchema(db, {
      typeKey: "thing",
      userId: "u1",
    });
    const second = await resolveSchema(db, {
      typeKey: "thing",
      userId: "u1",
    });
    expect(db.selectCalls).toBe(1);
    expect(first.schemaVersion).toBe(second.schemaVersion);
    expect(first.zodSchema).toBe(second.zodSchema);
  });
});

describe("resolveSchema — tenant isolation", () => {
  it("does not return user B's schema to user A from cache", async () => {
    const db = new MockDB();
    // First, user A resolves their custom type.
    db.nextRow = {
      jsonSchema: { type: "object", properties: { a: { type: "string" } } },
      schemaVersion: "vA",
      userId: "user-a",
    };
    const a = await resolveSchema(db, { typeKey: "shared_key", userId: "user-a" });
    expect(a.schemaVersion).toBe("vA");
    expect(db.selectCalls).toBe(1);

    // Now user B asks for the same key. The cache must NOT serve user A's
    // entry. The DB returns nothing for user B (simulating the WHERE
    // clause filtering by userId).
    db.nextRow = null;
    await expect(
      resolveSchema(db, { typeKey: "shared_key", userId: "user-b" }),
    ).rejects.toBeInstanceOf(SchemaNotFoundError);
    expect(db.selectCalls).toBe(2);
  });
});
