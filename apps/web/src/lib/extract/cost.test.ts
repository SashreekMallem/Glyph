/**
 * Unit tests for cost computation, recording, and cap enforcement.
 *
 * Every external dep is mocked: Redis is a tiny in-memory fake, the db
 * is a builder stub that records the last update call. This keeps the
 * suite hermetic and fast.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

import {
  computeCostUsd,
  recordUsage,
  checkDailyCap,
  checkPerDocCap,
  usdToMicros,
  microsToUsd,
  utcDateKey,
  userCostKey,
  docCostKey,
  MODEL_PRICING,
} from "./cost";

// ---------------------------------------------------------------------------
// Mock the schema module so we don't pull in postgres types.
// ---------------------------------------------------------------------------

vi.mock("@/db/schema", () => ({
  extractionSessions: {
    id: { name: "id" },
    totalTokensIn: { name: "total_tokens_in" },
    totalTokensOut: { name: "total_tokens_out" },
    totalCachedTokens: { name: "total_cached_tokens" },
    totalCostMicros: { name: "total_cost_micros" },
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: (a: unknown, b: unknown) => ({ _op: "eq", a, b }),
  sql: Object.assign(
    (strings: TemplateStringsArray, ...vals: unknown[]) => ({
      _op: "sql",
      strings,
      vals,
    }),
    { raw: (s: string) => ({ _op: "sql_raw", s }) },
  ),
}));

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

class FakeRedis {
  store = new Map<string, number>();
  ttl = new Map<string, number>();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async get(key: string): Promise<any> {
    return this.store.has(key) ? String(this.store.get(key)) : null;
  }
  async incrby(key: string, n: number): Promise<number> {
    const cur = this.store.get(key) ?? 0;
    const next = cur + n;
    this.store.set(key, next);
    return next;
  }
  async expire(key: string, s: number): Promise<number> {
    this.ttl.set(key, s);
    return 1;
  }
}

interface UpdateCall {
  table: unknown;
  set: Record<string, unknown>;
  where: unknown;
}

function mockDB(): { db: { update: (t: unknown) => unknown }; calls: UpdateCall[] } {
  const calls: UpdateCall[] = [];
  const db = {
    update(table: unknown) {
      const call: UpdateCall = { table, set: {}, where: null };
      calls.push(call);
      return {
        set(row: Record<string, unknown>) {
          call.set = row;
          return {
            async where(cond: unknown) {
              call.where = cond;
              return undefined;
            },
          };
        },
      };
    },
  };
  return { db, calls };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("computeCostUsd", () => {
  it("computes input + cached + output components", () => {
    const usage = {
      promptTokens: 1_000_000,
      cachedTokens: 0,
      candidatesTokens: 1_000_000,
      totalTokens: 2_000_000,
    };
    // 1M input * 0.10 + 1M output * 0.40 = 0.50
    expect(computeCostUsd(usage, "gemini-2.5-flash-lite")).toBeCloseTo(0.5, 6);
  });

  it("subtracts cached tokens from billable prompt", () => {
    const usage = {
      promptTokens: 1_000_000,
      cachedTokens: 800_000,
      candidatesTokens: 0,
      totalTokens: 1_000_000,
    };
    // 200k * 0.10 / 1M + 800k * 0.025 / 1M = 0.02 + 0.02 = 0.04
    expect(computeCostUsd(usage, "gemini-2.5-flash-lite")).toBeCloseTo(0.04, 6);
  });

  it("falls back to default for unknown model", () => {
    const usage = {
      promptTokens: 1_000_000,
      cachedTokens: 0,
      candidatesTokens: 0,
      totalTokens: 1_000_000,
    };
    expect(computeCostUsd(usage, "made-up-model")).toBeCloseTo(0.1, 6);
  });

  it("treats negative or NaN inputs as zero", () => {
    const usage = {
      promptTokens: -5,
      cachedTokens: NaN,
      candidatesTokens: 0,
      totalTokens: 0,
    };
    expect(computeCostUsd(usage, "gemini-2.5-flash-lite")).toBe(0);
  });

  it("pricing const is the single source of truth", () => {
    expect(MODEL_PRICING["gemini-2.5-flash-lite"]!.inputPerM).toBe(0.1);
    expect(MODEL_PRICING["gemini-2.5-flash-lite"]!.cachedInputPerM).toBe(0.025);
    expect(MODEL_PRICING["gemini-2.5-flash-lite"]!.outputPerM).toBe(0.4);
  });
});

describe("usdToMicros / microsToUsd", () => {
  it("round-trips without drift at small amounts", () => {
    expect(microsToUsd(usdToMicros(0.000123))).toBeCloseTo(0.000123, 6);
    expect(microsToUsd(usdToMicros(1.5))).toBeCloseTo(1.5, 6);
  });

  it("treats invalid input as zero micros", () => {
    expect(usdToMicros(NaN)).toBe(0n);
    expect(usdToMicros(-1)).toBe(0n);
  });
});

describe("utcDateKey & redis keys", () => {
  it("formats UTC date as YYYY-MM-DD", () => {
    expect(utcDateKey(new Date("2026-04-29T23:59:00Z"))).toBe("2026-04-29");
    expect(utcDateKey(new Date("2026-01-05T00:00:00Z"))).toBe("2026-01-05");
  });

  it("user key is date-suffixed and doc key is not", () => {
    const u = userCostKey("u1", "2026-04-29");
    expect(u).toBe("extract:user-cost:u1:2026-04-29");
    expect(docCostKey("d1")).toBe("extract:doc-cost:d1");
  });
});

describe("recordUsage", () => {
  beforeEach(() => {
    process.env.TZ = "UTC";
  });

  it("writes to db and increments redis counters with TTL", async () => {
    const { db, calls } = mockDB();
    const redis = new FakeRedis();

    await recordUsage(db as never, redis as never, {
      userId: "u1",
      sessionId: "s1",
      docId: "d1",
      usage: {
        promptTokens: 1000,
        cachedTokens: 100,
        candidatesTokens: 500,
        totalTokens: 1500,
      },
      costUsd: 0.001,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.set).toHaveProperty("totalCostMicros");

    const userKey = userCostKey("u1");
    const dKey = docCostKey("d1");
    expect(redis.store.get(userKey)).toBe(1000); // 0.001 * 1e6
    expect(redis.store.get(dKey)).toBe(1000);
    expect(redis.ttl.get(userKey)).toBeGreaterThan(0);
    expect(redis.ttl.get(dKey)).toBeGreaterThan(0);
  });

  it("skips redis when costUsd <= 0", async () => {
    const { db } = mockDB();
    const redis = new FakeRedis();

    await recordUsage(db as never, redis as never, {
      userId: "u1",
      sessionId: "s1",
      usage: {
        promptTokens: 0,
        cachedTokens: 0,
        candidatesTokens: 0,
        totalTokens: 0,
      },
      costUsd: 0,
    });
    expect(redis.store.size).toBe(0);
  });

  it("works with null redis (db only)", async () => {
    const { db, calls } = mockDB();
    await recordUsage(db as never, null, {
      userId: "u1",
      sessionId: "s1",
      usage: {
        promptTokens: 100,
        cachedTokens: 0,
        candidatesTokens: 50,
        totalTokens: 150,
      },
      costUsd: 0.0001,
    });
    expect(calls).toHaveLength(1);
  });

  it("swallows redis errors", async () => {
    const { db } = mockDB();
    const broken = {
      async incrby() {
        throw new Error("upstash down");
      },
      async expire() {
        return 1;
      },
      async get() {
        return null;
      },
    };
    await expect(
      recordUsage(db as never, broken as never, {
        userId: "u1",
        sessionId: "s1",
        usage: {
          promptTokens: 1000,
          cachedTokens: 0,
          candidatesTokens: 500,
          totalTokens: 1500,
        },
        costUsd: 0.001,
      }),
    ).resolves.toBeUndefined();
  });
});

describe("checkDailyCap", () => {
  it("ok=true when no spending recorded", async () => {
    const redis = new FakeRedis();
    const r = await checkDailyCap(redis as never, { userId: "u1", capUsd: 1 });
    expect(r.ok).toBe(true);
    expect(r.currentUsd).toBe(0);
  });

  it("ok=false when at or over cap", async () => {
    const redis = new FakeRedis();
    redis.store.set(userCostKey("u1"), 1_000_000); // $1.00
    const r = await checkDailyCap(redis as never, { userId: "u1", capUsd: 1 });
    expect(r.ok).toBe(false);
    expect(r.currentUsd).toBeCloseTo(1.0, 6);
  });

  it("fails open with no redis", async () => {
    const r = await checkDailyCap(null, { userId: "u1", capUsd: 1 });
    expect(r.ok).toBe(true);
  });
});

describe("checkPerDocCap", () => {
  it("trips when accumulated cost exceeds cap", async () => {
    const redis = new FakeRedis();
    redis.store.set(docCostKey("d1"), 200_000); // $0.20
    const r = await checkPerDocCap(redis as never, { docId: "d1", capUsd: 0.1 });
    expect(r.ok).toBe(false);
  });
});
