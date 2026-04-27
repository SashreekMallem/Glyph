/**
 * ProseMirror doc ⇄ validated JSON.
 *
 * The editor tracks (path, text) pairs at the `field` level. To produce
 * a structured payload, we walk each field and assign its text to its
 * `path` inside a nested object, coercing simple scalar types based on
 * a caller-supplied hint map.
 *
 * Inverse direction: given a validated JSON object and a list of
 * `{ path, label, section }` field descriptors, build a minimal doc
 * whose structure mirrors the schema.
 */

import type { Node } from "prosemirror-model";
import { editorSchema } from "@/components/editor/schema";

export type FieldDescriptor = {
  readonly path: string;
  readonly label: string;
  readonly section: string;
  readonly type?: "string" | "number" | "boolean" | "date";
};

function coerce(
  text: string,
  type: FieldDescriptor["type"],
): string | number | boolean | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) return "";
  if (type === "number") {
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : trimmed;
  }
  if (type === "boolean") {
    if (/^(true|yes|y)$/i.test(trimmed)) return true;
    if (/^(false|no|n)$/i.test(trimmed)) return false;
    return trimmed;
  }
  return trimmed;
}

function assignPath(
  target: Record<string, unknown>,
  path: string,
  value: unknown,
): void {
  const parts = path.split(".").filter((p) => p.length > 0);
  if (parts.length === 0) return;
  let cursor: Record<string, unknown> | unknown[] = target;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i]!;
    const nextKey = parts[i + 1]!;
    const nextIsIndex = /^\d+$/.test(nextKey);
    const container = nextIsIndex ? [] : {};
    if (Array.isArray(cursor)) {
      const idx = Number(key);
      if (!Number.isInteger(idx)) return;
      if (cursor[idx] === undefined) cursor[idx] = container;
      cursor = cursor[idx] as Record<string, unknown> | unknown[];
    } else {
      if (cursor[key] === undefined) cursor[key] = container;
      cursor = cursor[key] as Record<string, unknown> | unknown[];
    }
  }
  const last = parts[parts.length - 1]!;
  if (Array.isArray(cursor)) {
    const idx = Number(last);
    if (Number.isInteger(idx)) cursor[idx] = value;
  } else {
    cursor[last] = value;
  }
}

/**
 * Resolve `$` index placeholders in a path against running per-array state.
 *
 * Paths like `experience.$.company` auto-scale: the first time we see any
 * field under `experience.$`, the index is 0. A new entry (index 1) opens
 * when we see a field kind (e.g. `company`) that was already used at the
 * current index. Nested `$` segments in the same path are each tracked
 * independently by the prefix that precedes them.
 */
type ArrayState = {
  index: number;
  usedKeys: Set<string>;
};

function resolvePlaceholders(
  path: string,
  arrays: Map<string, ArrayState>,
): string {
  const parts = path.split(".");
  const resolved: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    if (part !== "$") {
      resolved.push(part);
      continue;
    }
    const prefix = resolved.join(".");
    const remaining = parts.slice(i + 1).join(".");
    let state = arrays.get(prefix);
    if (state === undefined) {
      state = { index: 0, usedKeys: new Set() };
      arrays.set(prefix, state);
    } else if (state.usedKeys.has(remaining)) {
      state.index += 1;
      state.usedKeys = new Set();
    }
    state.usedKeys.add(remaining);
    resolved.push(String(state.index));
  }
  return resolved.join(".");
}

/**
 * Walk a doc and build `{ path → text }` then assemble the nested JSON.
 * Field `type` comes from the descriptor map keyed by path. Paths may
 * contain `$` placeholders for array indices; they are auto-assigned in
 * document order and bumped when a field kind repeats within an entry.
 */
export function docToJson(
  doc: Node,
  typeByPath: Record<string, FieldDescriptor["type"]> = {},
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const arrays = new Map<string, ArrayState>();
  doc.descendants((node) => {
    if (node.type.name !== "field") return true;
    const rawPath = String(node.attrs.path ?? "");
    if (rawPath.length === 0) return false;
    const resolved = rawPath.includes("$")
      ? resolvePlaceholders(rawPath, arrays)
      : rawPath;
    const text = node.textContent;
    // typeByPath is keyed by the original descriptor path (with `$`).
    const typeHint = typeByPath[rawPath] ?? typeByPath[resolved];
    assignPath(out, resolved, coerce(text, typeHint));
    return false;
  });
  return out;
}

/** Build a minimal doc from a list of field descriptors + existing values. */
export function jsonToDoc(
  descriptors: readonly FieldDescriptor[],
  values: Record<string, unknown> = {},
): Node {
  // Group by section, preserving first-seen order.
  const sectionOrder: string[] = [];
  const bySection = new Map<string, FieldDescriptor[]>();
  for (const d of descriptors) {
    if (!bySection.has(d.section)) {
      sectionOrder.push(d.section);
      bySection.set(d.section, []);
    }
    bySection.get(d.section)!.push(d);
  }

  const sectionNodes = sectionOrder.map((sectionName) => {
    const fields = bySection.get(sectionName)!.map((d) => {
      const raw = readPath(values, d.path);
      const text = raw === undefined || raw === null ? "" : String(raw);
      return editorSchema.nodes.field.create(
        { path: d.path, label: d.label },
        text.length > 0 ? editorSchema.text(text) : null,
      );
    });
    // Sections must have at least one field; callers should pass at
    // least one descriptor per section.
    return editorSchema.nodes.section.create(
      { heading: sectionName },
      fields,
    );
  });

  return editorSchema.nodes.doc.create(null, sectionNodes);
}

function readPath(obj: unknown, path: string): unknown {
  const parts = path.split(".").filter((p) => p.length > 0);
  let cursor: unknown = obj;
  for (const p of parts) {
    if (cursor === null || typeof cursor !== "object") return undefined;
    if (Array.isArray(cursor)) {
      const idx = Number(p);
      if (!Number.isInteger(idx)) return undefined;
      cursor = cursor[idx];
    } else {
      cursor = (cursor as Record<string, unknown>)[p];
    }
  }
  return cursor;
}
