// Stable serialization for Gemini prefix caching.
//
// Why this exists: Gemini's prefix cache only hits when a byte-identical
// prefix is sent. JSON.stringify does not guarantee key order across runs or
// inputs, so we need a deterministic, sorted-key serializer to produce a
// stable cache prefix and a content-addressed breakpoint id.

import { createHash } from "node:crypto";

export interface CacheBreakpoint {
  /** The cacheable content (system + schema + examples). */
  prefix: string;
  /** SHA-256 hex of `prefix`; used as cache key. */
  breakpointId: string;
  /** Byte length of `prefix` (UTF-8). Useful for cost estimation. */
  prefixBytes: number;
}

export interface BuildCacheInput {
  /** JSON Schema for the document type. */
  schemaJson: unknown;
  /** System instructions to the model. */
  systemPrompt: string;
  /** Few-shot examples (positional — order matters). */
  examples?: unknown[];
}

/**
 * Deterministically serialize a JSON-like value with sorted object keys at
 * every depth and no whitespace.
 *
 * Throws on values that cannot be safely cached (NaN, Infinity, BigInt,
 * functions, symbols, circular refs).
 */
export function stableStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  return serialize(value, seen);
}

function serialize(value: unknown, seen: WeakSet<object>): string {
  if (value === null) return "null";

  const t = typeof value;

  if (t === "string") {
    return JSON.stringify(value);
  }

  if (t === "number") {
    const n = value as number;
    if (Number.isNaN(n)) {
      throw new Error(
        "stableStringify: NaN is not supported (would break prefix caching)",
      );
    }
    if (!Number.isFinite(n)) {
      throw new Error(
        "stableStringify: Infinity/-Infinity is not supported (would break prefix caching)",
      );
    }
    // JSON's default representation for finite numbers.
    return JSON.stringify(n);
  }

  if (t === "boolean") {
    return value ? "true" : "false";
  }

  if (t === "bigint") {
    throw new Error("stableStringify: BigInt is not supported");
  }

  if (t === "function") {
    throw new Error("stableStringify: functions are not supported");
  }

  if (t === "symbol") {
    throw new Error("stableStringify: symbols are not supported");
  }

  if (t === "undefined") {
    // Top-level / array-element handling is decided by callers; a bare
    // undefined here serializes as `null` (matches array-element behavior).
    return "null";
  }

  // Objects from here on.
  const obj = value as object;

  if (seen.has(obj)) {
    throw new Error("stableStringify: circular reference detected");
  }

  if (value instanceof Date) {
    return JSON.stringify(value.toISOString());
  }

  if (Array.isArray(value)) {
    seen.add(obj);
    try {
      const parts = value.map((el) =>
        el === undefined ? "null" : serialize(el, seen),
      );
      return "[" + parts.join(",") + "]";
    } finally {
      seen.delete(obj);
    }
  }

  // Plain object: sort keys, omit undefined values.
  seen.add(obj);
  try {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    const parts: string[] = [];
    for (const key of keys) {
      const v = record[key];
      if (v === undefined) continue;
      parts.push(JSON.stringify(key) + ":" + serialize(v, seen));
    }
    return "{" + parts.join(",") + "}";
  } finally {
    seen.delete(obj);
  }
}

/**
 * Build a deterministic, content-addressed cache breakpoint for a Gemini
 * cached-content prefix composed of system prompt + schema + examples.
 */
export function buildCacheBreakpoints(input: BuildCacheInput): CacheBreakpoint {
  const examples = input.examples ?? [];
  const prefix =
    "<system>\n" +
    input.systemPrompt +
    "\n</system>\n" +
    "<schema>\n" +
    stableStringify(input.schemaJson) +
    "\n</schema>\n" +
    "<examples>\n" +
    stableStringify(examples) +
    "\n</examples>";

  const breakpointId = createHash("sha256").update(prefix, "utf8").digest("hex");
  const prefixBytes = Buffer.byteLength(prefix, "utf8");

  return { prefix, breakpointId, prefixBytes };
}
