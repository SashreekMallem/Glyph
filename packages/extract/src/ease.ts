// EASE — Explicitly Addressed Sequence Encoding
//
// Transforms array values in data into objects keyed by stable string ids
// + a `display_order` array. This lets LLM-emitted JSON Patches reference
// elements by stable key rather than by positional index, which would
// otherwise drift across multi-step edits.

import { z } from "zod";

export interface EaseEncoded {
  __ease__: true;
  display_order: string[];
  [key: string]: unknown;
}

const KEY_PREFIX = "item_";
const KEY_PAD = 4;

// ---------------------------------------------------------------------------
// Type guards / key minting
// ---------------------------------------------------------------------------

export function isEaseEncoded(value: unknown): value is EaseEncoded {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    (value as Record<string, unknown>).__ease__ === true &&
    Array.isArray((value as Record<string, unknown>).display_order)
  );
}

function formatKey(n: number): string {
  return `${KEY_PREFIX}${String(n).padStart(KEY_PAD, "0")}`;
}

function parseKeyNumber(key: string): number | null {
  if (!key.startsWith(KEY_PREFIX)) return null;
  const suffix = key.slice(KEY_PREFIX.length);
  if (!/^\d+$/.test(suffix)) return null;
  return parseInt(suffix, 10);
}

function highestKeyNumber(container: EaseEncoded): number {
  let max = 0;
  // Consider both display_order and any orphaned keys still present
  for (const key of container.display_order) {
    const n = parseKeyNumber(key);
    if (n !== null && n > max) max = n;
  }
  for (const key of Object.keys(container)) {
    if (key === "__ease__" || key === "display_order") continue;
    const n = parseKeyNumber(key);
    if (n !== null && n > max) max = n;
  }
  return max;
}

export function nextKey(container: EaseEncoded): string {
  return formatKey(highestKeyNumber(container) + 1);
}

export function allocateKey(container: EaseEncoded): {
  key: string;
  container: EaseEncoded;
} {
  const key = nextKey(container);
  const next: EaseEncoded = {
    ...container,
    display_order: [...container.display_order, key],
  };
  return { key, container: next };
}

// ---------------------------------------------------------------------------
// Schema unwrapping
// ---------------------------------------------------------------------------

/**
 * Strip wrappers that don't change shape: Optional, Nullable, Default, Effects (refine/transform), Lazy.
 * Returns the innermost meaningful schema.
 */
function unwrapSchema(schema: z.ZodTypeAny): z.ZodTypeAny {
  let current: z.ZodTypeAny = schema;
  // Defensive bound to prevent infinite loops on pathological lazy schemas
  for (let i = 0; i < 64; i++) {
    if (current instanceof z.ZodOptional) {
      current = current._def.innerType;
      continue;
    }
    if (current instanceof z.ZodNullable) {
      current = current._def.innerType;
      continue;
    }
    if (current instanceof z.ZodDefault) {
      current = current._def.innerType;
      continue;
    }
    if (current instanceof z.ZodEffects) {
      current = current._def.schema;
      continue;
    }
    if (current instanceof z.ZodLazy) {
      try {
        current = current._def.getter();
        continue;
      } catch {
        return current;
      }
    }
    break;
  }
  return current;
}

// ---------------------------------------------------------------------------
// Encode
// ---------------------------------------------------------------------------

export function encode(value: unknown, schema: z.ZodTypeAny): unknown {
  return encodeWalk(value, schema);
}

function encodeWalk(value: unknown, schema: z.ZodTypeAny): unknown {
  if (value === undefined || value === null) return value;

  const unwrapped = unwrapSchema(schema);

  // Array site — the heart of EASE
  if (unwrapped instanceof z.ZodArray) {
    const elementSchema: z.ZodTypeAny = unwrapped._def.type;

    // Already encoded? recurse into existing keys (idempotence).
    if (isEaseEncoded(value)) {
      const result: EaseEncoded = {
        __ease__: true,
        display_order: [...value.display_order],
      };
      for (const key of value.display_order) {
        result[key] = encodeWalk(value[key], elementSchema);
      }
      return result;
    }

    if (!Array.isArray(value)) {
      // schema/data mismatch — degrade gracefully
      // eslint-disable-next-line no-console
      console.warn("[ease] encode: expected array, got", typeof value);
      return value;
    }

    const display_order: string[] = [];
    const result: EaseEncoded = {
      __ease__: true,
      display_order,
    };
    for (let i = 0; i < value.length; i++) {
      const key = formatKey(i + 1);
      display_order.push(key);
      result[key] = encodeWalk(value[i], elementSchema);
    }
    return result;
  }

  if (unwrapped instanceof z.ZodObject) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return value;
    }
    const shape = unwrapped.shape as Record<string, z.ZodTypeAny>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const childSchema = shape[k];
      if (childSchema) {
        out[k] = encodeWalk(v, childSchema);
      } else {
        out[k] = v;
      }
    }
    return out;
  }

  if (unwrapped instanceof z.ZodRecord) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return value;
    }
    const valueSchema: z.ZodTypeAny = unwrapped._def.valueType;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = encodeWalk(v, valueSchema);
    }
    return out;
  }

  if (
    unwrapped instanceof z.ZodUnion ||
    unwrapped instanceof z.ZodDiscriminatedUnion
  ) {
    const options: z.ZodTypeAny[] =
      unwrapped instanceof z.ZodDiscriminatedUnion
        ? Array.from(unwrapped._def.options as z.ZodTypeAny[])
        : (unwrapped._def.options as z.ZodTypeAny[]);
    // Pick the first option that successfully parses the value
    for (const opt of options) {
      if (opt.safeParse(value).success) {
        return encodeWalk(value, opt);
      }
    }
    return value;
  }

  // Primitives, any, unknown — pass through
  return value;
}

// ---------------------------------------------------------------------------
// Decode
// ---------------------------------------------------------------------------

export function decode(value: unknown, schema: z.ZodTypeAny): unknown {
  return decodeWalk(value, schema);
}

function decodeWalk(value: unknown, schema: z.ZodTypeAny): unknown {
  if (value === undefined || value === null) return value;

  const unwrapped = unwrapSchema(schema);

  if (unwrapped instanceof z.ZodArray) {
    const elementSchema: z.ZodTypeAny = unwrapped._def.type;

    if (isEaseEncoded(value)) {
      const out: unknown[] = [];
      for (const key of value.display_order) {
        if (Object.prototype.hasOwnProperty.call(value, key)) {
          out.push(decodeWalk(value[key], elementSchema));
        }
      }
      return out;
    }

    if (Array.isArray(value)) {
      // Idempotent: already a plain array. Recurse into elements in case
      // they contain inner EASE-encoded arrays.
      return value.map((v) => decodeWalk(v, elementSchema));
    }

    // eslint-disable-next-line no-console
    console.warn("[ease] decode: expected array or EASE container");
    return value;
  }

  if (unwrapped instanceof z.ZodObject) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return value;
    }
    const shape = unwrapped.shape as Record<string, z.ZodTypeAny>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const childSchema = shape[k];
      if (childSchema) {
        out[k] = decodeWalk(v, childSchema);
      } else {
        out[k] = v;
      }
    }
    return out;
  }

  if (unwrapped instanceof z.ZodRecord) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return value;
    }
    const valueSchema: z.ZodTypeAny = unwrapped._def.valueType;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = decodeWalk(v, valueSchema);
    }
    return out;
  }

  if (
    unwrapped instanceof z.ZodUnion ||
    unwrapped instanceof z.ZodDiscriminatedUnion
  ) {
    const options: z.ZodTypeAny[] =
      unwrapped instanceof z.ZodDiscriminatedUnion
        ? Array.from(unwrapped._def.options as z.ZodTypeAny[])
        : (unwrapped._def.options as z.ZodTypeAny[]);
    // For decode, an EASE container is "valid" only against an array option.
    if (isEaseEncoded(value)) {
      for (const opt of options) {
        if (unwrapSchema(opt) instanceof z.ZodArray) {
          return decodeWalk(value, opt);
        }
      }
      return value;
    }
    // Try each option: prefer one whose decoded form parses cleanly.
    // The encoded form may not parse (arrays-as-EASE-objects), so we
    // attempt decode-and-validate per option.
    for (const opt of options) {
      const candidate = decodeWalk(value, opt);
      if (opt.safeParse(candidate).success) {
        return candidate;
      }
    }
    // Fallback: recurse into the first option (best effort) — degrades gracefully
    return options[0] ? decodeWalk(value, options[0]) : value;
  }

  return value;
}
