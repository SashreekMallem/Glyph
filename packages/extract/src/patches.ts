// RFC 6902 patch applier (EASE-aware)
//
// Applies JSON Patch operations to an EASE-encoded state. The applier knows
// about the EASE convention: an object with `__ease__: true` and
// `display_order: string[]` represents an ordered array of items keyed by
// stable `item_NNNN` ids. Adds/removes/moves into such containers maintain
// the `display_order` invariant.

import type { z } from "zod";
import type { RFC6902Op, RFC6902Patch } from "./types";
import { isEaseEncoded, allocateKey, type EaseEncoded } from "./ease";

export type PatchErrorKind = "path" | "schema" | "test" | "type";

export interface PatchError {
  op: number;
  path: string;
  message: string;
  kind: PatchErrorKind;
}

export interface ApplyResult {
  state: unknown;
  errors: PatchError[];
}

// ---------------------------------------------------------------------------
// JSON Pointer (RFC 6901)
// ---------------------------------------------------------------------------

/** Unescape a single JSON Pointer reference token. */
function unescapeToken(token: string): string {
  // ~1 -> /, ~0 -> ~. Order matters: decode ~1 first, then ~0.
  return token.replace(/~1/g, "/").replace(/~0/g, "~");
}

/** Parse a JSON Pointer string into reference tokens. */
export function parsePointer(pointer: string): string[] {
  if (pointer === "") return [];
  if (!pointer.startsWith("/")) {
    throw new PointerError(`Invalid JSON Pointer (must start with '/'): ${pointer}`);
  }
  return pointer
    .slice(1)
    .split("/")
    .map(unescapeToken);
}

class PointerError extends Error {}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function clone<T>(v: T): T {
  // Node 17+
  return structuredClone(v);
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  if (Array.isArray(b)) return false;
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const ak = Object.keys(ao);
  const bk = Object.keys(bo);
  if (ak.length !== bk.length) return false;
  for (const k of ak) {
    if (!Object.prototype.hasOwnProperty.call(bo, k)) return false;
    if (!deepEqual(ao[k], bo[k])) return false;
  }
  return true;
}

/**
 * Resolve all but the last token of `tokens` against `root`, returning the
 * parent container plus the final token (already unescaped).
 */
function resolveParent(
  root: unknown,
  tokens: string[],
): { parent: unknown; key: string } {
  if (tokens.length === 0) {
    throw new PointerError("Cannot resolve parent of root");
  }
  let cur: unknown = root;
  for (let i = 0; i < tokens.length - 1; i++) {
    cur = step(cur, tokens[i]!);
  }
  return { parent: cur, key: tokens[tokens.length - 1]! };
}

function resolveValue(root: unknown, tokens: string[]): unknown {
  let cur: unknown = root;
  for (const t of tokens) {
    cur = step(cur, t);
  }
  return cur;
}

function step(container: unknown, token: string): unknown {
  if (Array.isArray(container)) {
    if (token === "-") {
      throw new PointerError(`'-' is not a valid index for read access`);
    }
    if (!/^(0|[1-9]\d*)$/.test(token)) {
      throw new PointerError(`Invalid array index: ${token}`);
    }
    const idx = parseInt(token, 10);
    if (idx < 0 || idx >= container.length) {
      throw new PointerError(`Array index out of bounds: ${idx}`);
    }
    return container[idx];
  }
  if (isPlainObject(container)) {
    if (!Object.prototype.hasOwnProperty.call(container, token)) {
      throw new PointerError(`Missing key: ${token}`);
    }
    return container[token];
  }
  throw new PointerError(`Cannot index into non-container at token '${token}'`);
}

/** Add `value` at parent[key]. Mutates parent (we're working on a clone). */
function addInto(parent: unknown, key: string, value: unknown): void {
  if (Array.isArray(parent)) {
    if (key === "-") {
      parent.push(value);
      return;
    }
    if (!/^(0|[1-9]\d*)$/.test(key)) {
      throw new PointerError(`Invalid array index: ${key}`);
    }
    const idx = parseInt(key, 10);
    if (idx < 0 || idx > parent.length) {
      throw new PointerError(`Array index out of bounds: ${idx}`);
    }
    parent.splice(idx, 0, value);
    return;
  }
  if (isEaseEncoded(parent)) {
    const ease = parent as EaseEncoded;
    if (key === "-") {
      // Allocate a new key
      const allocated = allocateKey(ease);
      // Mutate in place: copy display_order, set new key
      ease.display_order.length = 0;
      for (const k of allocated.container.display_order) ease.display_order.push(k);
      ease[allocated.key] = value;
      return;
    }
    // Adding by explicit key: place into display_order if not already there.
    ease[key] = value;
    if (!ease.display_order.includes(key)) {
      ease.display_order.push(key);
    }
    return;
  }
  if (isPlainObject(parent)) {
    parent[key] = value;
    return;
  }
  throw new PointerError(`Cannot add into non-container`);
}

function removeFrom(parent: unknown, key: string): unknown {
  if (Array.isArray(parent)) {
    if (!/^(0|[1-9]\d*)$/.test(key)) {
      throw new PointerError(`Invalid array index: ${key}`);
    }
    const idx = parseInt(key, 10);
    if (idx < 0 || idx >= parent.length) {
      throw new PointerError(`Array index out of bounds: ${idx}`);
    }
    const [removed] = parent.splice(idx, 1);
    return removed;
  }
  if (isEaseEncoded(parent)) {
    const ease = parent as EaseEncoded;
    if (!Object.prototype.hasOwnProperty.call(ease, key)) {
      throw new PointerError(`Missing key: ${key}`);
    }
    if (key === "__ease__" || key === "display_order") {
      throw new PointerError(`Cannot remove EASE meta key: ${key}`);
    }
    const removed = ease[key];
    delete ease[key];
    const i = ease.display_order.indexOf(key);
    if (i !== -1) ease.display_order.splice(i, 1);
    return removed;
  }
  if (isPlainObject(parent)) {
    if (!Object.prototype.hasOwnProperty.call(parent, key)) {
      throw new PointerError(`Missing key: ${key}`);
    }
    const removed = parent[key];
    delete parent[key];
    return removed;
  }
  throw new PointerError(`Cannot remove from non-container`);
}

function replaceAt(parent: unknown, key: string, value: unknown): void {
  if (Array.isArray(parent)) {
    if (!/^(0|[1-9]\d*)$/.test(key)) {
      throw new PointerError(`Invalid array index: ${key}`);
    }
    const idx = parseInt(key, 10);
    if (idx < 0 || idx >= parent.length) {
      throw new PointerError(`Array index out of bounds: ${idx}`);
    }
    parent[idx] = value;
    return;
  }
  if (isEaseEncoded(parent)) {
    const ease = parent as EaseEncoded;
    if (!Object.prototype.hasOwnProperty.call(ease, key)) {
      throw new PointerError(`Missing key: ${key}`);
    }
    ease[key] = value;
    return;
  }
  if (isPlainObject(parent)) {
    if (!Object.prototype.hasOwnProperty.call(parent, key)) {
      throw new PointerError(`Missing key: ${key}`);
    }
    parent[key] = value;
    return;
  }
  throw new PointerError(`Cannot replace in non-container`);
}

// ---------------------------------------------------------------------------
// Apply a single op (against a *cloned* state). Returns the resulting state.
// Throws PointerError on hard structural failures.
// ---------------------------------------------------------------------------

function applyOpInPlace(state: unknown, op: RFC6902Op): unknown {
  switch (op.op) {
    case "add": {
      const tokens = parsePointer(op.path);
      if (tokens.length === 0) {
        // Replace root
        return clone(op.value);
      }
      const { parent, key } = resolveParent(state, tokens);
      addInto(parent, key, clone(op.value));
      return state;
    }
    case "remove": {
      const tokens = parsePointer(op.path);
      if (tokens.length === 0) {
        throw new PointerError("Cannot remove root");
      }
      const { parent, key } = resolveParent(state, tokens);
      removeFrom(parent, key);
      return state;
    }
    case "replace": {
      const tokens = parsePointer(op.path);
      if (tokens.length === 0) {
        return clone(op.value);
      }
      const { parent, key } = resolveParent(state, tokens);
      replaceAt(parent, key, clone(op.value));
      return state;
    }
    case "test": {
      const tokens = parsePointer(op.path);
      const actual = tokens.length === 0 ? state : resolveValue(state, tokens);
      if (!deepEqual(actual, op.value)) {
        const e = new PointerError(`test failed at ${op.path}`);
        (e as Error & { kind?: string }).kind = "test";
        throw e;
      }
      return state;
    }
    case "move": {
      const fromTokens = parsePointer(op.from);
      const toTokens = parsePointer(op.path);
      if (fromTokens.length === 0) {
        throw new PointerError("Cannot move root");
      }
      // Forbid moving into own subtree
      if (
        toTokens.length >= fromTokens.length &&
        fromTokens.every((t, i) => toTokens[i] === t)
      ) {
        // Allow same-path no-op? Spec says path must not be a proper prefix of from for the *opposite* direction; here we forbid moving into descendant.
        if (toTokens.length > fromTokens.length) {
          throw new PointerError("Cannot move into own subtree");
        }
      }
      const { parent: fromParent, key: fromKey } = resolveParent(state, fromTokens);
      const removed = removeFrom(fromParent, fromKey);
      if (toTokens.length === 0) {
        return removed;
      }
      const { parent: toParent, key: toKey } = resolveParent(state, toTokens);
      addInto(toParent, toKey, removed);
      return state;
    }
    case "copy": {
      const fromTokens = parsePointer(op.from);
      const value = fromTokens.length === 0
        ? state
        : resolveValue(state, fromTokens);
      const copied = clone(value);
      const toTokens = parsePointer(op.path);
      if (toTokens.length === 0) {
        return copied;
      }
      const { parent: toParent, key: toKey } = resolveParent(state, toTokens);
      addInto(toParent, toKey, copied);
      return state;
    }
    default: {
      const e = new PointerError(
        `Unknown op: ${(op as { op?: string }).op ?? "<missing>"}`,
      );
      (e as Error & { kind?: string }).kind = "type";
      throw e;
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Apply a single op. Pure: input is not mutated. */
export function applyPatch(
  state: unknown,
  op: RFC6902Op,
  schema?: z.ZodTypeAny,
): ApplyResult {
  return applyPatches(state, [op], schema);
}

/**
 * Apply a sequence of ops.
 *
 * - Hard structural failures (invalid path, missing key, failed `test`,
 *   unknown op) roll back the *entire* call to the entry state.
 * - Soft schema-validation failures (when a schema is provided) roll back
 *   only the offending op; prior successful ops persist.
 */
export function applyPatches(
  state: unknown,
  patch: RFC6902Patch,
  schema?: z.ZodTypeAny,
): ApplyResult {
  const entry = clone(state);
  const errors: PatchError[] = [];

  // partialSchema is computed lazily and once.
  let partialSchema: z.ZodTypeAny | null = null;
  const getPartialSchema = (): z.ZodTypeAny | null => {
    if (partialSchema) return partialSchema;
    if (!schema) return null;
    const anySchema = schema as unknown as {
      deepPartial?: () => z.ZodTypeAny;
    };
    if (typeof anySchema.deepPartial === "function") {
      partialSchema = anySchema.deepPartial();
    } else {
      partialSchema = schema;
    }
    return partialSchema;
  };

  let current: unknown = clone(entry);

  for (let i = 0; i < patch.length; i++) {
    const op = patch[i]!;
    const path = (op as { path?: string }).path ?? "";

    // Try the op against a snapshot.
    const snapshot = clone(current);
    let next: unknown;
    try {
      next = applyOpInPlace(clone(current), op);
    } catch (err) {
      const kind: PatchErrorKind =
        (err as Error & { kind?: PatchErrorKind }).kind ?? "path";
      errors.push({
        op: i,
        path,
        message: (err as Error).message,
        kind,
      });
      // Hard failure: roll back entire call.
      return { state: entry, errors };
    }

    // Soft schema validation
    const ps = getPartialSchema();
    if (ps) {
      const result = ps.safeParse(next);
      if (!result.success) {
        errors.push({
          op: i,
          path,
          message: result.error.message,
          kind: "schema",
        });
        // Roll back THIS op only.
        current = snapshot;
        continue;
      }
    }

    current = next;
  }

  return { state: current, errors };
}
