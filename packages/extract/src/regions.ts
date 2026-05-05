import type { RFC6902Op } from "./types.js";

/**
 * Build a per-leaf-path region map from a stream of ops carrying optional
 * source spans. JSON Pointer paths (`/a/0/b`) are converted to dot-notation
 * (`a.0.b`) — the canonical key shape used by the fingerprint + drift modules
 * and the embedded payload `_meta`.
 *
 * Last-writer-wins: if the model emits multiple ops at the same path
 * (replace after add, supersedes), only the last span is retained.
 *
 * Pure function. No I/O.
 */
export type FieldRegions = Record<string, [number, number]>;

function pointerToDot(pointer: string): string {
  if (pointer === "" || pointer === "/") return "";
  // RFC 6901 unescape: ~1 -> /, ~0 -> ~
  return pointer
    .replace(/^\//, "")
    .split("/")
    .map((t) => t.replace(/~1/g, "/").replace(/~0/g, "~"))
    .join(".");
}

export function regionsFromOps(ops: readonly RFC6902Op[]): FieldRegions {
  const out: FieldRegions = {};
  for (const op of ops) {
    if (op.op === "remove" || op.op === "move" || op.op === "copy") continue;
    const span = op as Partial<{ srcStart: number; srcEnd: number }>;
    if (
      !Number.isInteger(span.srcStart) ||
      !Number.isInteger(span.srcEnd) ||
      (span.srcStart as number) < 0 ||
      (span.srcEnd as number) < (span.srcStart as number)
    ) {
      continue;
    }
    const path = pointerToDot(op.path);
    if (path === "") continue;
    out[path] = [span.srcStart as number, span.srcEnd as number];
  }
  return out;
}
