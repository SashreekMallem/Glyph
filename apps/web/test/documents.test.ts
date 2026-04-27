import "./setup-keys";

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Document } from "@/db/schema";

// ---------------------------------------------------------------------------
// In-memory Drizzle stub
// ---------------------------------------------------------------------------

type Row = Document;

interface TypeRow {
  id: string;
  key: string;
  name: string;
  description: string | null;
  schemaVersion: string;
  jsonSchema: unknown;
  rendererId: string;
  isSystem: boolean;
  userId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const store: { docs: Row[]; types: TypeRow[] } = {
  docs: [],
  types: [
    {
      id: "00000000-0000-0000-0000-00000000c0c0",
      key: "contract",
      name: "Contract",
      description: null,
      schemaVersion: "1.0",
      jsonSchema: {},
      rendererId: "contract",
      isSystem: true,
      userId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ],
};

function makeRow(patch: Partial<Row>): Row {
  const now = new Date();
  return {
    id: patch.id ?? "33333333-3333-3333-3333-333333333333",
    userId: patch.userId ?? "44444444-4444-4444-4444-444444444444",
    title: patch.title ?? "Untitled",
    documentType: patch.documentType ?? "contract",
    documentTypeKey: patch.documentTypeKey ?? "contract",
    templateId: patch.templateId ?? null,
    schemaVersion: patch.schemaVersion ?? "1.0",
    prosemirrorState: patch.prosemirrorState ?? null,
    validatedJson: patch.validatedJson ?? null,
    encryptedPayload: patch.encryptedPayload ?? null,
    payloadSignature: patch.payloadSignature ?? null,
    payloadIv: patch.payloadIv ?? null,
    payloadTag: patch.payloadTag ?? null,
    isFinalized: patch.isFinalized ?? false,
    createdAt: patch.createdAt ?? now,
    updatedAt: patch.updatedAt ?? now,
  };
}

vi.mock("@/db", () => {
  // Hand-rolled chainable DSL supporting the operations documents.ts uses.
  type Pending =
    | { kind: "select" }
    | { kind: "insert"; values?: Partial<Row>[] }
    | { kind: "update"; values?: Partial<Row> }
    | { kind: "delete" };

  const make = () => {
    let pending: Pending = { kind: "select" };
    let filterUserId: string | null = null;
    let filterId: string | null = null;
    let table: "docs" | "types" = "docs";

    const applyFilter = (rows: Row[]): Row[] => {
      return rows.filter(
        (r) =>
          (filterId === null || r.id === filterId) &&
          (filterUserId === null || r.userId === filterUserId),
      );
    };

    const chain = {
      // Where expressions can't be inspected cleanly via Drizzle's `and(eq(...))`
      // return value; instead we install spies on the db methods to capture the
      // target ids/userIds that the router passes to `findOwned`/writes.
      // The documents.ts code always filters by (id, userId) pair or userId.
      _setFilters(f: { id?: string; userId?: string }) {
        if (f.id !== undefined) filterId = f.id;
        if (f.userId !== undefined) filterUserId = f.userId;
      },
      from(t?: unknown) {
        // Drizzle tables expose column accessors; sniff for the `key`
        // column which only exists on `document_types`.
        const obj = t as Record<string, unknown> | undefined;
        if (obj && typeof obj === "object" && "key" in obj && "jsonSchema" in obj) {
          table = "types";
        } else {
          table = "docs";
        }
        return chain;
      },
      where() {
        return chain;
      },
      orderBy() {
        return chain;
      },
      limit() {
        if (pending.kind === "select") {
          if (table === "types") return store.types.slice(0, 1);
          return applyFilter(store.docs).slice(0, 1);
        }
        return chain;
      },
      returning() {
        if (pending.kind === "insert") {
          const rows = (pending.values ?? []).map((v) => makeRow(v));
          store.docs.push(...rows);
          return rows;
        }
        if (pending.kind === "update") {
          const patch = pending.values ?? {};
          const found = applyFilter(store.docs);
          for (const r of found) Object.assign(r, patch);
          return found;
        }
        if (pending.kind === "delete") {
          const found = applyFilter(store.docs);
          store.docs = store.docs.filter((r) => !found.includes(r));
          return found.map((r) => ({ id: r.id }));
        }
        return [];
      },
      values(v: Partial<Row> | Partial<Row>[]) {
        if (pending.kind === "insert") {
          pending.values = Array.isArray(v) ? v : [v];
        }
        return chain;
      },
      set(v: Partial<Row>) {
        if (pending.kind === "update") pending.values = v;
        return chain;
      },
    };

    return {
      select: () => {
        pending = { kind: "select" };
        filterUserId = null;
        filterId = null;
        return chain;
      },
      insert: () => {
        pending = { kind: "insert" };
        filterUserId = null;
        filterId = null;
        return {
          values: (v: Partial<Row> | Partial<Row>[]) => {
            if (pending.kind === "insert") pending.values = Array.isArray(v) ? v : [v];
            return { returning: () => chain.returning() };
          },
        };
      },
      update: () => {
        pending = { kind: "update" };
        return {
          set: (v: Partial<Row>) => {
            if (pending.kind === "update") pending.values = v;
            return {
              where: (where: { _id?: string; _userId?: string } | unknown) => {
                const w = where as { _id?: string; _userId?: string };
                if (w._id) filterId = w._id;
                if (w._userId) filterUserId = w._userId;
                return { returning: () => chain.returning() };
              },
            };
          },
        };
      },
      delete: () => {
        pending = { kind: "delete" };
        return {
          where: (where: unknown) => {
            const w = where as { _id?: string; _userId?: string };
            if (w._id) filterId = w._id;
            if (w._userId) filterUserId = w._userId;
            return { returning: () => chain.returning() };
          },
        };
      },
    };
  };

  // This stub is extremely simple — it returns the first doc matching userId
  // when select-from-documents is chained with any .where(), which is what
  // findOwned does. For tests we set `store.docs` to contain exactly one doc
  // per test and set its userId to match the caller.
  return { db: make() };
});

// We need `eq`/`and` to return inert marker objects — they're called by the router
// but our stub doesn't read them.
vi.mock("drizzle-orm", async () => {
  const actual = await vi.importActual<typeof import("drizzle-orm")>("drizzle-orm");
  return {
    ...actual,
    eq: (_col: unknown, _val: unknown) => ({ _marker: "eq" }),
    and: (..._args: unknown[]) => ({ _marker: "and" }),
    desc: (_col: unknown) => ({ _marker: "desc" }),
    gte: (_a: unknown, _b: unknown) => ({ _marker: "gte" }),
    count: () => ({ _marker: "count" }),
    sql: Object.assign(
      (..._args: unknown[]) => ({ _marker: "sql" }),
      { raw: (_s: string) => ({ _marker: "sql.raw" }) },
    ),
  };
});

// ---------------------------------------------------------------------------
// Router tests
// ---------------------------------------------------------------------------

import { appRouter } from "@/server/routers/_app";
import type { Context } from "@/server/context";

function makeCtx(userId: string | null): Context {
  return {
    // Supabase client isn't used by our procedures; cast through unknown.
    supabase: {} as unknown as Context["supabase"],
    user: (userId
      ? { id: userId, app_metadata: {}, user_metadata: {}, aud: "authenticated", created_at: new Date().toISOString() }
      : null) as unknown as Context["user"],
  };
}

beforeEach(() => {
  store.docs = [];
});

describe("documents router", () => {
  it("rejects unauthenticated callers", async () => {
    const caller = appRouter.createCaller(makeCtx(null));
    await expect(
      caller.documents.create({ typeKey: "contract", title: "x" }),
    ).rejects.toThrow(/UNAUTHORIZED/i);
  });

  it("create inserts a document for the caller", async () => {
    const caller = appRouter.createCaller(makeCtx("44444444-4444-4444-4444-444444444444"));
    const doc = await caller.documents.create({
      typeKey: "contract",
      title: "Service Agreement",
    });
    expect(doc.title).toBe("Service Agreement");
    expect(doc.documentType).toBe("contract");
    expect(doc.isFinalized).toBe(false);
    expect(store.docs.length).toBe(1);
    expect(store.docs[0]!.userId).toBe("44444444-4444-4444-4444-444444444444");
  });

  it("save accepts partial payloads (strict validation happens at finalize)", async () => {
    store.docs.push(
      makeRow({
        id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        userId: "44444444-4444-4444-4444-444444444444",
        documentType: "contract",
      }),
    );
    const caller = appRouter.createCaller(makeCtx("44444444-4444-4444-4444-444444444444"));
    // A partial payload (not yet schema-valid) should still save — the
    // prose-first editor emits incomplete JSON until the classifier has
    // finished labeling all required fields.
    const saved = await caller.documents.save({
      id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      prosemirrorState: { type: "doc" },
      validatedJson: { document_type: "contract" },
    });
    expect(saved.id).toBe("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    expect(saved.isFinalized).toBe(false);
  });

  it("finalize encrypts and signs, stripping plaintext", async () => {
    const id = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
    store.docs.push(
      makeRow({
        id,
        userId: "44444444-4444-4444-4444-444444444444",
        documentType: "contract",
        validatedJson: {
          document_type: "contract",
          schema_version: "1.0",
          parties: [
            { name: "Acme", role: "client" },
            { name: "Beta", role: "vendor" },
          ],
          effective_date: "2025-01-01",
          obligations: [{ party: "Acme", description: "Pay on time" }],
          governing_law: "Delaware",
          confidentiality: false,
        },
      }),
    );
    const caller = appRouter.createCaller(makeCtx("44444444-4444-4444-4444-444444444444"));
    const out = await caller.documents.finalize({ id });
    expect(out.isFinalized).toBe(true);
    expect(out.validatedJson).toBeUndefined();
    const stored = store.docs.find((d) => d.id === id);
    expect(stored?.encryptedPayload).toBeTruthy();
    expect(stored?.payloadIv).toBeTruthy();
    expect(stored?.payloadTag).toBeTruthy();
    expect(stored?.payloadSignature).toBeTruthy();
    expect(stored?.isFinalized).toBe(true);
  });
});
