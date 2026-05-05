/**
 * Unit tests for the SSE streaming extraction route.
 *
 * Strategy: every external dependency (Supabase auth, Drizzle, Redis,
 * gemini streamExtract, episodes module, schema-library) is mocked via
 * `vi.mock`. We can then construct a `NextRequest`, call the route's
 * `POST` handler, and either inspect the JSON error response or pull
 * SSE events from the stream body.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Mocks (declared before importing the route).
// ---------------------------------------------------------------------------

// Stub the lazy env validator so route tests don't need real Upstash /
// Supabase secrets. We set GEMINI_API_KEY in vitest.setup.ts; everything
// else flows through this mock.
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
const mockSessionSumWhere = vi.fn();

vi.mock("@/db", () => {
  // Tiny chainable stub. The route makes:
  //   db.select({...}).from(documents).where(...).limit(1)
  //   db.update(extractionSessions).set({...}).where(...)   (recordUsage)
  let pendingTable: "documents" | "sessions" | null = null;
  const builder: Record<string, unknown> = {};
  builder.select = (cols?: unknown) => {
    void cols;
    pendingTable = null;
    return {
      from: (table: { _label?: string }) => {
        pendingTable = table?._label === "sessions" ? "sessions" : "documents";
        return {
          where: (_cond: unknown) => {
            if (pendingTable === "sessions") {
              return mockSessionSumWhere();
            }
            return {
              limit: (_n: number) => mockDocSelectLimit(),
            };
          },
        };
      },
    };
  };
  builder.update = (_t: unknown) => ({
    set: (_row: unknown) => ({
      where: async (_cond: unknown) => undefined,
    }),
  });
  return { db: builder };
});

vi.mock("@/db/schema", () => ({
  documents: { _label: "documents", id: { name: "id" }, userId: { name: "user_id" }, schemaVersion: { name: "schema_version" } },
  extractionSessions: {
    _label: "sessions",
    userId: { name: "user_id" },
    startedAt: { name: "started_at" },
    totalCostMicros: { name: "total_cost_micros" },
  },
}));

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ _op: "and", args }),
  eq: (a: unknown, b: unknown) => ({ _op: "eq", a, b }),
  gte: (a: unknown, b: unknown) => ({ _op: "gte", a, b }),
  sql: Object.assign(
    (strings: TemplateStringsArray, ...vals: unknown[]) => ({
      _op: "sql",
      strings,
      vals,
    }),
    {
      raw: (s: string) => ({ _op: "sql_raw", s }),
    },
  ),
}));

const mockAppendEpisode = vi.fn(async () => ({ id: "ep-1", appliedAt: new Date() }));
const mockFoldCurrent = vi.fn(async () => ({ state: {}, errors: [], episodeCount: 0 }));
const mockCreateSession = vi.fn(async () => ({ id: "sess-mock" }));
const mockEndSession = vi.fn(async () => undefined);

vi.mock("@/lib/extract/episodes", () => ({
  appendEpisode: (...a: unknown[]) => (mockAppendEpisode as (...args: unknown[]) => unknown)(...a),
  foldCurrent: (...a: unknown[]) => (mockFoldCurrent as (...args: unknown[]) => unknown)(...a),
  createSession: (...a: unknown[]) => (mockCreateSession as (...args: unknown[]) => unknown)(...a),
  endSession: (...a: unknown[]) => (mockEndSession as (...args: unknown[]) => unknown)(...a),
}));

const mockRedisSet = vi.fn();
const mockRedisGet = vi.fn(async (_key?: string): Promise<string | null> => null);
const mockRedisEval = vi.fn(async () => 1);
const mockRedisIncrby = vi.fn(async () => 0);
const mockRedisExpire = vi.fn(async () => 1);
let redisAvailable = true;
vi.mock("@/lib/redis", () => ({
  getRedis: () =>
    redisAvailable
      ? {
          set: mockRedisSet,
          get: mockRedisGet,
          eval: mockRedisEval,
          incrby: mockRedisIncrby,
          expire: mockRedisExpire,
        }
      : null,
  RELEASE_LOCK_SCRIPT: "release",
}));

const mockEnsureCache = vi.fn(async () => null);
let mockExtractEvents: Array<{
  type: string;
  patches?: unknown;
  usage?: unknown;
  error?: string;
}> = [];
let mockExtractDelay = 0;
let extractAborted = false;

vi.mock("@glyph/extract", () => ({
  ensureCache: (...a: unknown[]) => (mockEnsureCache as (...args: unknown[]) => unknown)(...a),
  streamExtract: async function* (
    _req: unknown,
    opts: { signal?: AbortSignal },
  ) {
    extractAborted = false;
    for (const ev of mockExtractEvents) {
      if (mockExtractDelay > 0) {
        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(resolve, mockExtractDelay);
          opts.signal?.addEventListener(
            "abort",
            () => {
              clearTimeout(t);
              extractAborted = true;
              reject(new DOMException("Aborted", "AbortError"));
            },
            { once: true },
          );
        });
      }
      if (opts.signal?.aborted) {
        extractAborted = true;
        return;
      }
      yield ev;
    }
  },
}));

vi.mock("@glyph/schema-library", () => ({
  getSchema: () => ({ _zod: true }),
  toJsonSchema: () => ({ type: "object", properties: {} }),
}));

// ---------------------------------------------------------------------------
// Import route AFTER mocks.
// ---------------------------------------------------------------------------

import { POST } from "./route";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeReq(
  body: unknown,
  init: { signal?: AbortSignal } = {},
): NextRequest {
  const r = new Request("http://localhost/api/extract/stream", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    signal: init.signal,
  });
  // NextRequest is structurally compatible with Request for our route's needs.
  return r as unknown as NextRequest;
}

async function readSSE(res: Response): Promise<string> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let out = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  return out;
}

function parseSSE(text: string): Array<{ event: string; data: unknown }> {
  const events: Array<{ event: string; data: unknown }> = [];
  const blocks = text.split("\n\n").filter((b) => b.trim().length > 0);
  for (const block of blocks) {
    if (block.startsWith(": ")) continue; // heartbeat comment
    let event = "message";
    const dataLines: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("event: ")) event = line.slice(7);
      else if (line.startsWith("data: ")) dataLines.push(line.slice(6));
    }
    let data: unknown = dataLines.join("\n");
    try {
      data = JSON.parse(dataLines.join("\n"));
    } catch {
      /* leave as string */
    }
    events.push({ event, data });
  }
  return events;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const VALID_BODY = {
  docId: "00000000-0000-0000-0000-000000000001",
  schemaType: "contract",
  textDelta: "hello world",
  clientSeq: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  redisAvailable = true;
  mockExtractEvents = [];
  mockExtractDelay = 0;
  extractAborted = false;
  delete process.env.EXTRACT_USER_DAILY_USD_CAP;
  process.env.GEMINI_API_KEY = "test-key";
  // Default happy-path mocks.
  mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
  mockDocSelectLimit.mockResolvedValue([
    { id: VALID_BODY.docId, userId: "user-1", schemaVersion: "1.0" },
  ]);
  mockSessionSumWhere.mockResolvedValue([{ total: "0" }]);
  mockRedisSet.mockResolvedValue("OK");
  mockRedisGet.mockResolvedValue(null);
  mockRedisEval.mockResolvedValue(1);
});

describe("POST /api/extract/stream", () => {
  it("returns 401 without a session", async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null } });
    const res = await POST(makeReq(VALID_BODY));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("unauthorized");
  });

  it("returns 403 when user does not own the doc", async () => {
    mockDocSelectLimit.mockResolvedValueOnce([
      { id: VALID_BODY.docId, userId: "someone-else", schemaVersion: "1.0" },
    ]);
    const res = await POST(makeReq(VALID_BODY));
    expect(res.status).toBe(403);
  });

  it("returns 404 when doc does not exist", async () => {
    mockDocSelectLimit.mockResolvedValueOnce([]);
    const res = await POST(makeReq(VALID_BODY));
    expect(res.status).toBe(404);
  });

  it("returns 400 on invalid body", async () => {
    const res = await POST(makeReq({ junk: true }));
    expect(res.status).toBe(400);
  });

  it("returns 409 when mutex is contended", async () => {
    mockRedisSet.mockResolvedValueOnce(null); // NX failed
    const res = await POST(makeReq(VALID_BODY));
    expect(res.status).toBe(409);
    expect(res.headers.get("Retry-After")).toBe("1");
  });

  it("returns 402 when over the daily cost cap", async () => {
    process.env.EXTRACT_USER_DAILY_USD_CAP = "1.00";
    // Redis-backed counter: $2.00 already spent (2_000_000 micros).
    mockRedisGet.mockImplementation(async (key) => {
      if (typeof key === "string" && key.startsWith("extract:user-cost:")) {
        return "2000000";
      }
      return null;
    });
    const res = await POST(makeReq(VALID_BODY));
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.error).toBe("cost_cap_exceeded");
    expect(body.kind).toBe("user");
  });

  it("happy path: streams events, appends episodes, ends session", async () => {
    mockExtractEvents = [
      {
        type: "patch",
        patches: [{ op: "add", path: "/title", value: "Hi" }],
      },
      {
        type: "usage",
        usage: {
          promptTokens: 100,
          cachedTokens: 50,
          candidatesTokens: 25,
          totalTokens: 125,
          costUsd: 0.0001,
        },
      },
      { type: "done" },
    ];

    const res = await POST(makeReq(VALID_BODY));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/event-stream");
    expect(res.headers.get("X-Accel-Buffering")).toBe("no");

    const text = await readSSE(res);
    const events = parseSSE(text);

    const types = events.map((e) => e.event);
    expect(types).toContain("ready");
    expect(types).toContain("patch");
    expect(types).toContain("usage");
    expect(types).toContain("done");

    // Session lifecycle
    expect(mockCreateSession).toHaveBeenCalledTimes(1);
    expect(mockEndSession).toHaveBeenCalledTimes(1);
    expect((mockEndSession.mock.calls[0] as unknown[])[1]).toMatchObject({
      sessionId: "sess-mock",
      status: "succeeded",
    });

    // Episode appended for each patch op
    expect(mockAppendEpisode).toHaveBeenCalledTimes(1);

    // Lock acquired and released
    expect(mockRedisSet).toHaveBeenCalled();
    expect(mockRedisEval).toHaveBeenCalled();
  });

  it("SSE frames are RFC-compliant (event:/data: lines, blank-line terminator)", async () => {
    mockExtractEvents = [
      { type: "patch", patches: [{ op: "add", path: "/x", value: 1 }] },
      { type: "done" },
    ];
    const res = await POST(makeReq(VALID_BODY));
    const text = await readSSE(res);
    expect(text).toMatch(/event: ready\ndata: \{[^\n]*\}\n\n/);
    expect(text).toMatch(/event: patch\ndata: \{[^\n]*\}\n\n/);
    expect(text).toMatch(/event: done\ndata: \{[^\n]*\}\n\n/);
  });

  it("forwards model errors as event: error and still releases the lock", async () => {
    mockExtractEvents = [{ type: "error", error: "boom" }];
    const res = await POST(makeReq(VALID_BODY));
    const text = await readSSE(res);
    const events = parseSSE(text);
    const errEv = events.find((e) => e.event === "error");
    expect(errEv).toBeDefined();
    expect((errEv?.data as { error: string }).error).toBe("boom");
    expect(mockRedisEval).toHaveBeenCalled(); // lock released
    expect(mockEndSession).toHaveBeenCalled();
  });

  it("releases mutex when session creation fails", async () => {
    mockCreateSession.mockRejectedValueOnce(new Error("db down"));
    const res = await POST(makeReq(VALID_BODY));
    expect(res.status).toBe(500);
    expect(mockRedisEval).toHaveBeenCalled();
  });

  it("client disconnect aborts the gemini stream and releases the lock", async () => {
    mockExtractEvents = [
      { type: "patch", patches: [{ op: "add", path: "/x", value: 1 }] },
      { type: "patch", patches: [{ op: "add", path: "/y", value: 2 }] },
      { type: "done" },
    ];
    mockExtractDelay = 50;

    const ac = new AbortController();
    const res = await POST(makeReq(VALID_BODY, { signal: ac.signal }));
    const reader = res.body!.getReader();

    // Read the first frame (ready) then cancel.
    await reader.read();
    await reader.cancel();

    // Give the background generator a tick to observe the abort.
    await new Promise((r) => setTimeout(r, 80));

    expect(mockRedisEval).toHaveBeenCalled();
  });
});
