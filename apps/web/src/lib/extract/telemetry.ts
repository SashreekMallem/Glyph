/**
 * Lightweight extraction-pipeline telemetry.
 *
 * v1 emits structured single-line JSON to stdout; Vercel's log drain
 * captures these for ingestion. Counters and histograms are persisted
 * to Redis (Upstash) with TTL-bounded keys so we never grow unbounded.
 *
 * UPGRADE PATH: when we adopt OpenTelemetry the surface here stays
 * stable — logExtractEvent becomes a span attribute writer,
 * metric.increment becomes an OTel counter, metric.observe becomes a
 * histogram observation. Callers don't change.
 *
 * Sensitive data policy:
 *   - NEVER log raw textDelta, fullText, schema bodies, or JWTs.
 *   - IDs and short hashes are OK.
 *   - The sanitizer in `safeLog` strips any field whose key contains
 *     "token", "jwt", "secret", "key", "delta", "schema", "text" unless
 *     the field is a numeric counter (e.g. `tokensIn`).
 */

import { createHash } from "node:crypto";

import type { Redis } from "@upstash/redis";

import { getRedis } from "@/lib/redis";

// ---------------------------------------------------------------------------
// Event types
// ---------------------------------------------------------------------------

export type ExtractEventName =
  | "extract.start"
  | "extract.patch"
  | "extract.usage"
  | "extract.error"
  | "extract.done"
  | "extract.cap_exceeded"
  | "extract.cache_hit"
  | "extract.cache_miss"
  | "extract.lock_contention"
  | "extract.fold"
  | "extract.schema_resolve";

export interface LogExtractEventArgs {
  readonly event: ExtractEventName | string;
  readonly requestId?: string;
  readonly userId?: string;
  readonly docId?: string;
  readonly sessionId?: string;
  readonly model?: string;
  readonly durationMs?: number;
  readonly tokens?: {
    in?: number;
    out?: number;
    cached?: number;
  };
  readonly costUsd?: number;
  readonly error?: string;
  readonly schemaSource?: "builtin" | "custom";
  readonly schemaVersion?: string;
  /** Optional opaque key/value extension; sanitised before emit. */
  readonly extra?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// SLO targets — exported as a const so dashboards / alerts pull from one place.
// ---------------------------------------------------------------------------

export const SLO_TARGETS = {
  /** End-to-end SSE latency budget. */
  latencyP50Ms: 2_000,
  latencyP95Ms: 5_000,
  /** Successful streams / total. */
  successRate: 0.99,
  /** Gemini prefix-cache hit rate. */
  cacheHitRate: 0.7,
} as const;

// ---------------------------------------------------------------------------
// Sensitive-data sanitiser
// ---------------------------------------------------------------------------

const SENSITIVE_KEY_RE = /(secret|jwt|password|delta|fulltext|schemajson|apikey)/i;
/**
 * Allow keys like "tokensIn" or "totalTokens" through — they're counters,
 * not payloads. The disallow-list covers obvious payload fields.
 */
const ALLOW_KEY_RE = /^(tokens?(in|out|cached|total)?|total[a-z]*|count|.*ms|.*usd)$/i;

function sanitize(v: unknown, depth = 0): unknown {
  if (depth > 4) return "[depth-limit]";
  if (v === null || v === undefined) return v;
  if (typeof v === "string") {
    // Strings with bearer-like patterns are scrubbed.
    if (/^Bearer\s+/i.test(v) || /^eyJ[A-Za-z0-9_-]{8,}\./.test(v)) {
      return "[redacted]";
    }
    return v.length > 256 ? `${v.slice(0, 64)}…(len=${v.length})` : v;
  }
  if (typeof v === "number" || typeof v === "boolean") return v;
  if (typeof v === "bigint") return v.toString();
  if (Array.isArray(v)) return v.slice(0, 32).map((x) => sanitize(x, depth + 1));
  if (typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (SENSITIVE_KEY_RE.test(k) && !ALLOW_KEY_RE.test(k)) {
        out[k] = "[redacted]";
        continue;
      }
      out[k] = sanitize(val, depth + 1);
    }
    return out;
  }
  return "[unserialisable]";
}

/** Short hash for grouping log entries by, e.g., schemaVersion. */
export function hashId(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 12);
}

// ---------------------------------------------------------------------------
// JSON stdout writer
// ---------------------------------------------------------------------------

type LogSink = (line: string) => void;

let sink: LogSink = (line) => {
  // eslint-disable-next-line no-console
  console.log(line);
};

/** Test-only override. */
export function _setSink(fn: LogSink): void {
  sink = fn;
}
export function _resetSink(): void {
  sink = (line) => {
    // eslint-disable-next-line no-console
    console.log(line);
  };
}

export function logExtractEvent(args: LogExtractEventArgs): void {
  try {
    const sanitized = sanitize(args) as Record<string, unknown>;
    const record = {
      ts: new Date().toISOString(),
      level: args.error ? "error" : "info",
      ...sanitized,
    };
    sink(JSON.stringify(record));
  } catch {
    // Logging must never throw.
  }
}

// ---------------------------------------------------------------------------
// Metrics — Redis-backed counters + histogram buckets.
// ---------------------------------------------------------------------------

/**
 * Counter / histogram TTL. Long enough that scrape jobs catch the value
 * but bounded so we never build unbounded keyspace.
 */
const METRIC_TTL_S = 60 * 60 * 25; // 25h.

/**
 * Histogram buckets (ms). Mirrors the SLO ladder; observations land in
 * the lowest bucket they fit. We keep a small fixed set so the keyspace
 * stays tiny per metric name.
 */
export const HISTOGRAM_BUCKETS_MS = [
  100, 250, 500, 1_000, 2_000, 5_000, 10_000, 30_000, 60_000,
] as const;

function metricKey(name: string): string {
  return `metric:${name}`;
}

function bucketKey(name: string, bucket: number | "inf"): string {
  return `metric:${name}:bucket:${bucket}`;
}

async function ttlInc(redis: Redis, key: string, n = 1): Promise<void> {
  try {
    await redis.incrby(key, n);
    await redis.expire(key, METRIC_TTL_S);
  } catch {
    /* swallow */
  }
}

export interface MetricFns {
  increment(name: string, by?: number): Promise<void>;
  observe(name: string, valueMs: number): Promise<void>;
}

function makeMetrics(redis: Redis | null): MetricFns {
  if (!redis) {
    return {
      async increment() {
        /* no-op */
      },
      async observe() {
        /* no-op */
      },
    };
  }
  return {
    async increment(name, by = 1) {
      await ttlInc(redis, metricKey(name), by);
    },
    async observe(name, valueMs) {
      await ttlInc(redis, metricKey(`${name}:count`));
      await ttlInc(redis, metricKey(`${name}:sum`), Math.max(0, Math.round(valueMs)));
      // Cumulative histogram: bump every bucket >= value.
      let bucketed = false;
      for (const b of HISTOGRAM_BUCKETS_MS) {
        if (valueMs <= b) {
          await ttlInc(redis, bucketKey(name, b));
          bucketed = true;
          break;
        }
      }
      if (!bucketed) {
        await ttlInc(redis, bucketKey(name, "inf"));
      }
    },
  };
}

/**
 * Default metric facade: lazily resolves the shared Redis client on first
 * use. Tests can construct their own via `createMetrics(redis)`.
 */
export const metric: MetricFns = {
  async increment(name, by) {
    return makeMetrics(getRedis()).increment(name, by);
  },
  async observe(name, ms) {
    return makeMetrics(getRedis()).observe(name, ms);
  },
};

export function createMetrics(redis: Redis | null): MetricFns {
  return makeMetrics(redis);
}
