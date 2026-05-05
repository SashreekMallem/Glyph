/**
 * Telemetry unit tests.
 *
 * - Validates the structured-log writer emits a single JSON line with
 *   the expected shape, NEVER includes redacted fields.
 * - Counter / histogram helpers fan out to the expected Redis keys with
 *   TTLs.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

import {
  logExtractEvent,
  hashId,
  createMetrics,
  HISTOGRAM_BUCKETS_MS,
  SLO_TARGETS,
  _setSink,
  _resetSink,
} from "./telemetry";

// Avoid pulling the real redis module.
vi.mock("@/lib/redis", () => ({ getRedis: () => null }));

class FakeRedis {
  store = new Map<string, number>();
  ttl = new Map<string, number>();
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

describe("logExtractEvent", () => {
  let lines: string[] = [];

  beforeEach(() => {
    lines = [];
    _setSink((l) => lines.push(l));
  });

  it("emits a single JSON line with the standard envelope", () => {
    logExtractEvent({
      event: "extract.start",
      requestId: "r1",
      userId: "u1",
      docId: "d1",
      sessionId: "s1",
      durationMs: 123,
    });
    expect(lines).toHaveLength(1);
    const obj = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
    expect(obj.event).toBe("extract.start");
    expect(obj.requestId).toBe("r1");
    expect(obj.ts).toBeTypeOf("string");
    expect(obj.level).toBe("info");
  });

  it("redacts JWT-shaped strings and sensitive keys", () => {
    logExtractEvent({
      event: "extract.start",
      extra: {
        textDelta: "secret raw input",
        schemaJson: { foo: "bar" },
        apiKey: "AIza-very-secret",
        bearer: "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.sig",
        tokensIn: 42, // counter — must pass through.
      },
    });
    const obj = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
    const extra = obj.extra as Record<string, unknown>;
    expect(extra.textDelta).toBe("[redacted]");
    expect(extra.schemaJson).toBe("[redacted]");
    expect(extra.apiKey).toBe("[redacted]");
    expect(extra.bearer).toBe("[redacted]");
    expect(extra.tokensIn).toBe(42);
  });

  it("never throws on circular input", () => {
    const a: Record<string, unknown> = {};
    a.self = a;
    expect(() =>
      logExtractEvent({ event: "extract.start", extra: { a } }),
    ).not.toThrow();
  });

  it("flags errors as level=error", () => {
    logExtractEvent({ event: "extract.error", error: "boom" });
    const obj = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
    expect(obj.level).toBe("error");
    expect(obj.error).toBe("boom");
  });

  afterEach(() => {
    _resetSink();
  });
});

// vitest hoisting: declare here for clarity.
import { afterEach } from "vitest";

describe("hashId", () => {
  it("produces stable 12-char hex", () => {
    const a = hashId("foo");
    const b = hashId("foo");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{12}$/);
  });
});

describe("metrics", () => {
  it("increment fans out to redis with TTL", async () => {
    const r = new FakeRedis();
    const m = createMetrics(r as never);
    await m.increment("extract.requests");
    await m.increment("extract.requests");
    expect(r.store.get("metric:extract.requests")).toBe(2);
    expect(r.ttl.get("metric:extract.requests")).toBeGreaterThan(0);
  });

  it("observe writes count/sum/bucket keys", async () => {
    const r = new FakeRedis();
    const m = createMetrics(r as never);
    await m.observe("extract.latency_ms", 800);
    expect(r.store.get("metric:extract.latency_ms:count")).toBe(1);
    expect(r.store.get("metric:extract.latency_ms:sum")).toBe(800);
    // 800 falls into the 1_000 bucket.
    expect(r.store.get("metric:extract.latency_ms:bucket:1000")).toBe(1);
  });

  it("very large observations land in the inf bucket", async () => {
    const r = new FakeRedis();
    const m = createMetrics(r as never);
    const last = HISTOGRAM_BUCKETS_MS[HISTOGRAM_BUCKETS_MS.length - 1] ?? 60_000;
    const huge = last + 1;
    await m.observe("extract.latency_ms", huge);
    expect(r.store.get("metric:extract.latency_ms:bucket:inf")).toBe(1);
  });

  it("no-op when redis is null", async () => {
    const m = createMetrics(null);
    await expect(m.increment("foo")).resolves.toBeUndefined();
    await expect(m.observe("foo", 100)).resolves.toBeUndefined();
  });
});

describe("SLO_TARGETS", () => {
  it("is exported as a const", () => {
    expect(SLO_TARGETS.latencyP50Ms).toBe(2000);
    expect(SLO_TARGETS.successRate).toBe(0.99);
    expect(SLO_TARGETS.cacheHitRate).toBe(0.7);
  });
});
