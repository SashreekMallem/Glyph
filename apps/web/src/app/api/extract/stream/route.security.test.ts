/**
 * Security tests for the SSE extraction endpoint.
 *
 * These cover the trust boundary between an authenticated browser and
 * the extraction pipeline. Goals:
 *
 *   1. Tenant isolation — user A cannot stream into user B's doc.
 *   2. Body-size limit — pathological deltas are rejected before we
 *      hit auth/db.
 *   3. Schema injection — user A cannot resolve user B's custom type.
 *   4. Replay/idempotency — same clientSeq from same user is handled
 *      gracefully (no duplicate session-creation).
 *   5. Auth — missing JWT yields 401.
 *   6. Cap override — client-supplied cap fields in the body are ignored.
 *
 * Every external dependency is mocked, mirroring `route.test.ts`.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@/lib/extract/env", () => ({
  getExtractEnv: () => ({
    geminiApiKey: "test-gemini-key",
    upstashRedisRestUrl: "http://test",
    upstashRedisRestToken: "test",
    databaseUrl: "postgres://test",
    supabaseServiceRoleKey: "test",
    geminiModel: "gemini-2.5-flash-lite",
    userDailyUsdCap: 1.0,
    docUsdCap: 0.1,
  }),
  ExtractEnvError: class ExtractEnvError extends Error {},
}));

const mockGetUser = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: mockGetUser },
  }),
}));

const mockDocSelectLimit = vi.fn();

vi.mock("@/db", () => {
  const builder: Record<string, unknown> = {};
  builder.select = (_cols?: unknown) => ({
    from: (_table: unknown) => ({
      where: (_cond: unknown) => ({
        limit: (_n: number) => mockDocSelectLimit(),
      }),
    }),
  });
  builder.update = (_t: unknown) => ({
    set: (_row: unknown) => ({ where: async (_c: unknown) => undefined }),
  });
  return { db: builder };
});

vi.mock("@/db/schema", () => ({
  documents: {
    _label: "documents",
    id: { name: "id" },
    userId: { name: "user_id" },
    schemaVersion: { name: "schema_version" },
  },
  extractionSessions: {
    id: { name: "id" },
    totalTokensIn: { name: "total_tokens_in" },
    totalTokensOut: { name: "total_tokens_out" },
    totalCachedTokens: { name: "total_cached_tokens" },
    totalCostMicros: { name: "total_cost_micros" },
  },
}));

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ _op: "and", args }),
  eq: (a: unknown, b: unknown) => ({ _op: "eq", a, b }),
  sql: Object.assign(
    (s: TemplateStringsArray, ...vals: unknown[]) => ({ _op: "sql", s, vals }),
    { raw: (s: string) => ({ _op: "sql_raw", s }) },
  ),
}));

const mockAppendEpisode = vi.fn(async () => ({
  id: "ep-1",
  appliedAt: new Date(),
}));
const mockFoldCurrent = vi.fn(async () => ({
  state: {},
  errors: [],
  episodeCount: 0,
}));
const mockCreateSession = vi.fn(async () => ({ id: "sess-mock" }));
const mockEndSession = vi.fn(async () => undefined);

vi.mock("@/lib/extract/episodes", () => ({
  appendEpisode: (...a: unknown[]) =>
    (mockAppendEpisode as (...x: unknown[]) => unknown)(...a),
  foldCurrent: (...a: unknown[]) =>
    (mockFoldCurrent as (...x: unknown[]) => unknown)(...a),
  createSession: (...a: unknown[]) =>
    (mockCreateSession as (...x: unknown[]) => unknown)(...a),
  endSession: (...a: unknown[]) =>
    (mockEndSession as (...x: unknown[]) => unknown)(...a),
}));

const mockResolveSchema = vi.fn();
vi.mock("@/lib/extract/resolve-schema", () => {
  class SchemaNotFoundError extends Error {
    readonly typeKey: string;
    readonly userId?: string;
    constructor(typeKey: string, userId?: string) {
      super(`Schema not found for typeKey="${typeKey}"`);
      this.name = "SchemaNotFoundError";
      this.typeKey = typeKey;
      this.userId = userId;
    }
  }
  return {
    resolveSchema: (...a: unknown[]) =>
      (mockResolveSchema as (...x: unknown[]) => unknown)(...a),
    SchemaNotFoundError,
  };
});

const mockRedisSet = vi.fn(async () => "OK");
const mockRedisGet = vi.fn(async (_key?: string): Promise<string | null> => null);
const mockRedisEval = vi.fn(async () => 1);
const mockRedisIncrby = vi.fn(async () => 0);
const mockRedisExpire = vi.fn(async () => 1);
vi.mock("@/lib/redis", () => ({
  getRedis: () => ({
    set: mockRedisSet,
    get: mockRedisGet,
    eval: mockRedisEval,
    incrby: mockRedisIncrby,
    expire: mockRedisExpire,
  }),
  RELEASE_LOCK_SCRIPT: "release",
}));

vi.mock("@glyph/extract", () => ({
  ensureCache: async () => null,
  // eslint-disable-next-line require-yield
  streamExtract: async function* () {
    return;
  },
}));

vi.mock("@glyph/schema-library", () => ({
  getSchema: () => ({ _zod: true }),
  toJsonSchema: () => ({ type: "object" }),
}));

import { POST } from "./route";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeReq(body: unknown, headers: Record<string, string> = {}): NextRequest {
  const r = new Request("http://localhost/api/extract/stream", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json", ...headers },
  });
  return r as unknown as NextRequest;
}

const VALID_BODY = {
  docId: "00000000-0000-0000-0000-000000000001",
  schemaType: "contract",
  textDelta: "hello",
  clientSeq: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.EXTRACT_USER_DAILY_USD_CAP;
  delete process.env.EXTRACT_DOC_USD_CAP;
  process.env.GEMINI_API_KEY = "test-key";
  mockGetUser.mockResolvedValue({ data: { user: { id: "user-A" } } });
  mockDocSelectLimit.mockResolvedValue([
    { id: VALID_BODY.docId, userId: "user-A", schemaVersion: "1.0" },
  ]);
  mockResolveSchema.mockResolvedValue({
    zodSchema: { _zod: true },
    schemaJson: { type: "object" },
    schemaVersion: "1.0",
    source: "builtin",
  });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("security: tenant isolation", () => {
  it("user A cannot stream into user B's doc → 403", async () => {
    // Doc belongs to user-B; current session is user-A.
    mockDocSelectLimit.mockResolvedValueOnce([
      { id: VALID_BODY.docId, userId: "user-B", schemaVersion: "1.0" },
    ]);
    const res = await POST(makeReq(VALID_BODY));
    expect(res.status).toBe(403);
  });
});

describe("security: payload size", () => {
  it("textDelta > 1 MiB → 413", async () => {
    const big = "x".repeat(1024 * 1024 + 10);
    const res = await POST(makeReq({ ...VALID_BODY, textDelta: big }));
    expect(res.status).toBe(413);
  });

  it("oversized content-length is rejected pre-parse", async () => {
    const r = new Request("http://localhost/api/extract/stream", {
      method: "POST",
      body: JSON.stringify(VALID_BODY),
      headers: {
        "content-type": "application/json",
        "content-length": String(10 * 1024 * 1024),
      },
    });
    const res = await POST(r as unknown as NextRequest);
    expect(res.status).toBe(413);
  });
});

describe("security: schema-injection / cross-tenant types", () => {
  it("user A referencing user B's custom type → 400", async () => {
    const { SchemaNotFoundError } = await import("@/lib/extract/resolve-schema");
    mockResolveSchema.mockRejectedValueOnce(
      new SchemaNotFoundError("user-b-private", "user-A"),
    );
    const res = await POST(
      makeReq({ ...VALID_BODY, schemaType: "user-b-private" }),
    );
    expect(res.status).toBe(400);
  });
});

describe("security: replay / idempotency", () => {
  it("identical clientSeq from same user does not crash and is handled deterministically", async () => {
    // Two back-to-back calls with the same clientSeq. The route does NOT
    // explicitly dedupe at the entry point — it relies on the per-doc
    // mutex to serialise concurrent requests, and on the bi-temporal
    // store to make replays idempotent at the data layer. We assert
    // that both return without 5xx.
    mockRedisSet.mockResolvedValue("OK");
    const res1 = await POST(makeReq(VALID_BODY));
    const res2 = await POST(makeReq(VALID_BODY));
    expect([200, 409]).toContain(res1.status);
    expect([200, 409]).toContain(res2.status);
    // Drain bodies to avoid dangling streams in the test harness.
    await res1.body?.cancel().catch(() => {});
    await res2.body?.cancel().catch(() => {});
  });
});

describe("security: auth bypass", () => {
  it("missing session → 401", async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null } });
    const res = await POST(makeReq(VALID_BODY));
    expect(res.status).toBe(401);
  });
});

describe("security: cap override cannot be supplied by client", () => {
  it("body fields named `capUsd` / `daily_cap` etc. are ignored", async () => {
    process.env.EXTRACT_USER_DAILY_USD_CAP = "1.00";
    // Pretend redis already shows $2 spent — this MUST trip 402 even if
    // the client tries to bump capUsd via the request body.
    mockRedisGet.mockImplementation(async (key) => {
      if (typeof key === "string" && key.startsWith("extract:user-cost:")) {
        return "2000000";
      }
      return null;
    });
    const malicious = {
      ...VALID_BODY,
      capUsd: 9999,
      EXTRACT_USER_DAILY_USD_CAP: "9999",
      daily_cap: 9999,
    };
    const res = await POST(makeReq(malicious));
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.error).toBe("cost_cap_exceeded");
    // The reported cap MUST come from env, not from the malicious body.
    expect(body.capUsd).toBe(1);
  });
});
