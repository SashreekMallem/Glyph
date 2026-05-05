import { describe, it, expect } from "vitest";
import { z } from "zod";
import * as fc from "fast-check";

import {
  applyPatch,
  applyPatches,
  parsePointer,
} from "../src/patches";
import { isEaseEncoded, type EaseEncoded } from "../src/ease";
import type { RFC6902Patch } from "../src/types";

// ---------------------------------------------------------------------------
// JSON Pointer parsing
// ---------------------------------------------------------------------------

describe("parsePointer", () => {
  it("parses root pointer", () => {
    expect(parsePointer("")).toEqual([]);
  });

  it("decodes ~1 -> /  and ~0 -> ~", () => {
    expect(parsePointer("/a~1b")).toEqual(["a/b"]);
    expect(parsePointer("/a~0b")).toEqual(["a~b"]);
    // RFC 6901 example: "~01" decodes to "~1" (decode ~1 first, then ~0)
    expect(parsePointer("/~01")).toEqual(["~1"]);
  });

  it("rejects pointers that don't start with /", () => {
    const r = applyPatch({}, { op: "add", path: "foo", value: 1 });
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]!.kind).toBe("path");
  });
});

// ---------------------------------------------------------------------------
// Six basic ops on plain JSON
// ---------------------------------------------------------------------------

describe("plain JSON ops", () => {
  it("add", () => {
    const r = applyPatch({ a: 1 }, { op: "add", path: "/b", value: 2 });
    expect(r.errors).toEqual([]);
    expect(r.state).toEqual({ a: 1, b: 2 });
  });

  it("add into array by index", () => {
    const r = applyPatch(
      { xs: [1, 2, 3] },
      { op: "add", path: "/xs/1", value: 99 },
    );
    expect(r.state).toEqual({ xs: [1, 99, 2, 3] });
  });

  it("add to array tail with -", () => {
    const r = applyPatch(
      { xs: [1, 2] },
      { op: "add", path: "/xs/-", value: 3 },
    );
    expect(r.state).toEqual({ xs: [1, 2, 3] });
  });

  it("remove", () => {
    const r = applyPatch({ a: 1, b: 2 }, { op: "remove", path: "/a" });
    expect(r.state).toEqual({ b: 2 });
  });

  it("replace", () => {
    const r = applyPatch({ a: 1 }, { op: "replace", path: "/a", value: 9 });
    expect(r.state).toEqual({ a: 9 });
  });

  it("move", () => {
    const r = applyPatch(
      { a: 1, b: 2 },
      { op: "move", from: "/a", path: "/c" },
    );
    expect(r.state).toEqual({ b: 2, c: 1 });
  });

  it("copy", () => {
    const r = applyPatch(
      { a: { x: 1 } },
      { op: "copy", from: "/a", path: "/b" },
    );
    expect(r.state).toEqual({ a: { x: 1 }, b: { x: 1 } });
    // Verify it's a deep copy
    const s = r.state as { a: { x: number }; b: { x: number } };
    s.b.x = 7;
    expect(s.a.x).toBe(1);
  });

  it("test passes", () => {
    const r = applyPatch({ a: 1 }, { op: "test", path: "/a", value: 1 });
    expect(r.errors).toEqual([]);
  });

  it("test fails => rollback entire call", () => {
    const r = applyPatches({ a: 1 }, [
      { op: "replace", path: "/a", value: 5 },
      { op: "test", path: "/a", value: 999 },
    ]);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]!.kind).toBe("test");
    // Roll back to entry state
    expect(r.state).toEqual({ a: 1 });
  });

  it("replace root", () => {
    const r = applyPatch({ a: 1 }, { op: "replace", path: "", value: { z: 9 } });
    expect(r.state).toEqual({ z: 9 });
  });
});

// ---------------------------------------------------------------------------
// EASE-aware behavior
// ---------------------------------------------------------------------------

function makeEaseEmpty(): EaseEncoded {
  return { __ease__: true, display_order: [] };
}

function makeEase(items: Record<string, unknown>): EaseEncoded {
  const ease: EaseEncoded = { __ease__: true, display_order: Object.keys(items) };
  for (const [k, v] of Object.entries(items)) ease[k] = v;
  return ease;
}

describe("EASE-aware ops", () => {
  it("add /- allocates a new item_NNNN key", () => {
    const state = { tags: makeEaseEmpty() };
    const r = applyPatch(state, { op: "add", path: "/tags/-", value: "hi" });
    expect(r.errors).toEqual([]);
    const tags = (r.state as { tags: EaseEncoded }).tags;
    expect(isEaseEncoded(tags)).toBe(true);
    expect(tags.display_order).toEqual(["item_0001"]);
    expect(tags["item_0001"]).toBe("hi");
  });

  it("repeated /- add increments key numbers", () => {
    const state = { tags: makeEaseEmpty() };
    const r = applyPatches(state, [
      { op: "add", path: "/tags/-", value: "a" },
      { op: "add", path: "/tags/-", value: "b" },
      { op: "add", path: "/tags/-", value: "c" },
    ]);
    const tags = (r.state as { tags: EaseEncoded }).tags;
    expect(tags.display_order).toEqual(["item_0001", "item_0002", "item_0003"]);
    expect(tags["item_0001"]).toBe("a");
    expect(tags["item_0003"]).toBe("c");
  });

  it("remove from EASE updates display_order", () => {
    const state = {
      tags: makeEase({ item_0001: "a", item_0002: "b", item_0003: "c" }),
    };
    const r = applyPatch(state, { op: "remove", path: "/tags/item_0002" });
    const tags = (r.state as { tags: EaseEncoded }).tags;
    expect(tags.display_order).toEqual(["item_0001", "item_0003"]);
    expect(Object.prototype.hasOwnProperty.call(tags, "item_0002")).toBe(false);
  });

  it("replace into EASE preserves display_order", () => {
    const state = { tags: makeEase({ item_0001: "a", item_0002: "b" }) };
    const r = applyPatch(state, {
      op: "replace",
      path: "/tags/item_0001",
      value: "A",
    });
    const tags = (r.state as { tags: EaseEncoded }).tags;
    expect(tags.display_order).toEqual(["item_0001", "item_0002"]);
    expect(tags["item_0001"]).toBe("A");
  });

  it("move within EASE preserves invariants", () => {
    const state = {
      src: makeEase({ item_0001: "x", item_0002: "y" }),
      dst: makeEaseEmpty(),
    };
    const r = applyPatch(state, {
      op: "move",
      from: "/src/item_0001",
      path: "/dst/-",
    });
    const src = (r.state as { src: EaseEncoded; dst: EaseEncoded }).src;
    const dst = (r.state as { src: EaseEncoded; dst: EaseEncoded }).dst;
    expect(src.display_order).toEqual(["item_0002"]);
    expect(dst.display_order).toEqual(["item_0001"]);
    expect(dst["item_0001"]).toBe("x");
  });

  it("copy within EASE allocates a fresh key on the target", () => {
    const state = {
      src: makeEase({ item_0001: { v: 1 } }),
      dst: makeEase({ item_0001: { v: 2 } }),
    };
    const r = applyPatch(state, {
      op: "copy",
      from: "/src/item_0001",
      path: "/dst/-",
    });
    const dst = (r.state as { dst: EaseEncoded }).dst;
    expect(dst.display_order).toEqual(["item_0001", "item_0002"]);
    expect(dst["item_0002"]).toEqual({ v: 1 });
    // Deep copy — mutating the source should not affect the dst.
    const src = (r.state as { src: EaseEncoded }).src;
    (src["item_0001"] as { v: number }).v = 99;
    expect((dst["item_0002"] as { v: number }).v).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Pure / immutability
// ---------------------------------------------------------------------------

describe("purity", () => {
  it("does not mutate the input state", () => {
    const state = { a: 1, xs: [1, 2, 3] };
    const snap = JSON.stringify(state);
    applyPatches(state, [
      { op: "replace", path: "/a", value: 99 },
      { op: "add", path: "/xs/-", value: 4 },
    ]);
    expect(JSON.stringify(state)).toBe(snap);
  });
});

// ---------------------------------------------------------------------------
// Schema validation
// ---------------------------------------------------------------------------

describe("schema validation", () => {
  const schema = z.object({
    name: z.string(),
    age: z.number(),
  });

  it("rolls back ONLY the offending op on validation failure", () => {
    const r = applyPatches(
      { name: "Ada", age: 30 },
      [
        { op: "replace", path: "/name", value: "Bob" },
        { op: "replace", path: "/age", value: "not-a-number" }, // bad type
        { op: "replace", path: "/name", value: "Carol" },
      ],
      schema,
    );
    // bad-type op recorded as schema error
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]!.kind).toBe("schema");
    expect(r.errors[0]!.op).toBe(1);
    // First and third ops should have applied; second was rolled back
    expect(r.state).toEqual({ name: "Carol", age: 30 });
  });

  it("partial schema allows missing required fields mid-stream", () => {
    // Empty object should not fail the deepPartial form
    const r = applyPatches({}, [{ op: "add", path: "/name", value: "Ada" }], schema);
    expect(r.errors).toEqual([]);
    expect(r.state).toEqual({ name: "Ada" });
  });
});

// ---------------------------------------------------------------------------
// Atomicity on hard failure
// ---------------------------------------------------------------------------

describe("atomicity", () => {
  it("rolls back the whole call on a hard path failure", () => {
    const r = applyPatches({ a: 1 }, [
      { op: "replace", path: "/a", value: 99 },
      { op: "remove", path: "/does/not/exist" },
    ]);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]!.kind).toBe("path");
    expect(r.state).toEqual({ a: 1 });
  });

  it("returns errors with op index and path", () => {
    const r = applyPatches({}, [
      { op: "add", path: "/a", value: 1 },
      { op: "remove", path: "/missing" },
    ]);
    expect(r.errors[0]!.op).toBe(1);
    expect(r.errors[0]!.path).toBe("/missing");
  });
});

// ---------------------------------------------------------------------------
// Property test: random add/remove/replace preserve display_order ↔ keys
// ---------------------------------------------------------------------------

describe("property: display_order ↔ keys invariant", () => {
  type Op = RFC6902Patch[number];

  const opArb = fc.oneof(
    fc.record({
      op: fc.constant("add" as const),
      path: fc.constant("/items/-"),
      value: fc.string(),
    }) as fc.Arbitrary<Op>,
    fc.record({
      op: fc.constant("remove" as const),
      // Path is irrelevant since we'll rewrite it to a real key at apply time
      path: fc.constant("/items/REMOVE_RANDOM"),
    }) as fc.Arbitrary<Op>,
    fc.record({
      op: fc.constant("replace" as const),
      path: fc.constant("/items/REPLACE_RANDOM"),
      value: fc.string(),
    }) as fc.Arbitrary<Op>,
  );

  it("display_order keys exactly match the data keys after random ops", () => {
    fc.assert(
      fc.property(fc.array(opArb, { maxLength: 30 }), fc.integer(), (ops, seed) => {
        let rng = Math.abs(seed) || 1;
        const rand = () => {
          // xorshift for determinism per shrunk run
          rng ^= rng << 13;
          rng ^= rng >>> 17;
          rng ^= rng << 5;
          return Math.abs(rng);
        };

        let state: { items: EaseEncoded } = { items: makeEaseEmpty() };
        for (const op of ops) {
          let realOp: Op = op;
          if (op.op === "remove" || op.op === "replace") {
            const order = state.items.display_order;
            if (order.length === 0) continue; // skip
            const target = order[rand() % order.length]!;
            if (op.op === "remove") {
              realOp = { op: "remove", path: `/items/${target}` };
            } else {
              realOp = {
                op: "replace",
                path: `/items/${target}`,
                value: op.value,
              };
            }
          }
          const r = applyPatch(state, realOp);
          // No hard errors expected with our crafted ops
          expect(r.errors).toEqual([]);
          state = r.state as { items: EaseEncoded };

          // Invariant 1: every key in display_order is a property on items
          const items = state.items;
          for (const k of items.display_order) {
            expect(Object.prototype.hasOwnProperty.call(items, k)).toBe(true);
          }
          // Invariant 2: every non-meta property key appears in display_order
          const props = Object.keys(items).filter(
            (k) => k !== "__ease__" && k !== "display_order",
          );
          expect(new Set(props)).toEqual(new Set(items.display_order));
          // Invariant 3: display_order has no duplicates
          expect(new Set(items.display_order).size).toBe(
            items.display_order.length,
          );
        }
      }),
      { numRuns: 100 },
    );
  });
});
