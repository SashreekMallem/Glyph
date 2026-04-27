/**
 * Deterministic JSON serialization used for signed payloads.
 *
 * We sort object keys recursively and serialize with `JSON.stringify` using
 * its default separators. Arrays preserve their element order (order is
 * semantically meaningful for resumes, invoices, etc).
 *
 * The crypto package's `encryptPayload` does its own JSON.stringify, so
 * to guarantee a reproducible signature we pre-canonicalize to an object
 * whose in-order property enumeration matches this serialization — and
 * we also store the canonical string for callers that want to re-verify
 * without re-encrypting. Node's V8 preserves property insertion order
 * for string keys, so a recursive rebuild from sorted keys suffices.
 */

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [k: string]: JsonValue };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function canonicalValue(value: unknown): JsonValue {
  if (value === null) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("canonicalize: non-finite number is not JSON-encodable.");
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(canonicalValue);
  }
  if (isPlainObject(value)) {
    const keys = Object.keys(value).sort();
    const out: Record<string, JsonValue> = {};
    for (const k of keys) {
      const v = value[k];
      if (v === undefined) continue;
      out[k] = canonicalValue(v);
    }
    return out;
  }
  throw new Error(
    `canonicalize: unsupported value of type ${typeof value} encountered.`,
  );
}

/**
 * Return a canonical object (sorted keys, no undefined fields) suitable
 * for passing to `encryptPayload`.
 */
export function canonicalize(value: unknown): JsonValue {
  return canonicalValue(value);
}

/**
 * Return the canonical JSON string form. Equivalent to
 * `JSON.stringify(canonicalize(value))`.
 */
export function canonicalStringify(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}
