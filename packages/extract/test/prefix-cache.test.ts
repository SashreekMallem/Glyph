import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { createHash } from "node:crypto";
import {
  stableStringify,
  buildCacheBreakpoints,
} from "../src/prefix-cache.js";

describe("stableStringify", () => {
  it("1. object with reordered keys produces identical output", () => {
    const a = { a: 1, b: 2, c: 3 };
    const b = { c: 3, a: 1, b: 2 };
    const c = { b: 2, c: 3, a: 1 };
    expect(stableStringify(a)).toBe(stableStringify(b));
    expect(stableStringify(b)).toBe(stableStringify(c));
    expect(stableStringify(a)).toBe('{"a":1,"b":2,"c":3}');
  });

  it("2. nested object key permutations all stable", () => {
    const a = { z: { a: 1, b: 2 }, a: { y: 9, x: 8 } };
    const b = { a: { x: 8, y: 9 }, z: { b: 2, a: 1 } };
    expect(stableStringify(a)).toBe(stableStringify(b));
    expect(stableStringify(a)).toBe('{"a":{"x":8,"y":9},"z":{"a":1,"b":2}}');
  });

  it("3. arrays preserved in order", () => {
    expect(stableStringify([3, 1, 2])).toBe("[3,1,2]");
    expect(stableStringify([{ b: 2, a: 1 }, { d: 4, c: 3 }])).toBe(
      '[{"a":1,"b":2},{"c":3,"d":4}]',
    );
  });

  it("4. undefined values omitted from objects", () => {
    expect(stableStringify({ a: 1, b: undefined, c: 3 })).toBe('{"a":1,"c":3}');
    expect(stableStringify({ a: undefined })).toBe("{}");
  });

  it("5. null preserved", () => {
    expect(stableStringify(null)).toBe("null");
    expect(stableStringify({ a: null })).toBe('{"a":null}');
    expect(stableStringify([null, 1, null])).toBe("[null,1,null]");
  });

  it("6. Date converts to ISO string", () => {
    const d = new Date("2024-01-02T03:04:05.678Z");
    expect(stableStringify(d)).toBe('"2024-01-02T03:04:05.678Z"');
    expect(stableStringify({ when: d })).toBe(
      '{"when":"2024-01-02T03:04:05.678Z"}',
    );
  });

  it("7. NaN throws", () => {
    expect(() => stableStringify(NaN)).toThrow(/NaN/);
    expect(() => stableStringify({ x: NaN })).toThrow(/NaN/);
    expect(() => stableStringify(Infinity)).toThrow(/Infinity/);
    expect(() => stableStringify(-Infinity)).toThrow(/Infinity/);
  });

  it("8. BigInt throws", () => {
    expect(() => stableStringify(BigInt(1))).toThrow(/BigInt/);
    expect(() => stableStringify({ x: BigInt(1) })).toThrow(/BigInt/);
  });

  it("9. circular ref throws", () => {
    const obj: Record<string, unknown> = { a: 1 };
    obj.self = obj;
    expect(() => stableStringify(obj)).toThrow(/circular/i);

    const arr: unknown[] = [1, 2];
    arr.push(arr);
    expect(() => stableStringify(arr)).toThrow(/circular/i);
  });

  it("10. empty object serializes to {}", () => {
    expect(stableStringify({})).toBe("{}");
  });

  it("11. empty array serializes to []", () => {
    expect(stableStringify([])).toBe("[]");
  });

  it("12. special chars in strings escaped properly", () => {
    expect(stableStringify('a"b')).toBe('"a\\"b"');
    expect(stableStringify("a\nb")).toBe('"a\\nb"');
    expect(stableStringify("a\tb")).toBe('"a\\tb"');
    expect(stableStringify("a\\b")).toBe('"a\\\\b"');
    expect(stableStringify({ "k\"ey": "v\"al" })).toBe('{"k\\"ey":"v\\"al"}');
  });

  it("13. unicode in strings preserved", () => {
    expect(stableStringify("héllo")).toBe('"héllo"');
    expect(stableStringify("日本語")).toBe('"日本語"');
    expect(stableStringify("🎉")).toBe('"🎉"');
    expect(stableStringify({ greeting: "héllo 🎉" })).toBe(
      '{"greeting":"héllo 🎉"}',
    );
  });

  it("14. property test: random nested objects, key permutations stable (1000 iterations)", () => {
    // Recursive arbitrary that builds objects/arrays of JSON-safe primitives.
    const { tree } = fc.letrec((tie) => ({
      leaf: fc.oneof(
        fc.integer(),
        fc.double({ noNaN: true, noDefaultInfinity: true }),
        fc.string(),
        fc.boolean(),
        fc.constant(null),
      ),
      tree: fc.oneof(
        { maxDepth: 4, depthSize: "small" },
        tie("leaf"),
        fc.array(tie("tree"), { maxLength: 5 }),
        fc.dictionary(fc.string({ minLength: 1, maxLength: 6 }), tie("tree"), {
          maxKeys: 5,
        }),
      ),
    })) as { tree: fc.Arbitrary<unknown> };

    const permuteObjectKeys = (v: unknown): unknown => {
      if (Array.isArray(v)) return v.map(permuteObjectKeys);
      if (v && typeof v === "object" && !(v instanceof Date)) {
        const rec = v as Record<string, unknown>;
        const keys = Object.keys(rec);
        // Reverse + rotate to scramble — deterministic per-call.
        const reordered = [...keys].reverse();
        const out: Record<string, unknown> = {};
        for (const k of reordered) out[k] = permuteObjectKeys(rec[k]);
        return out;
      }
      return v;
    };

    fc.assert(
      fc.property(tree, (val) => {
        const a = stableStringify(val);
        const b = stableStringify(permuteObjectKeys(val));
        return a === b;
      }),
      { numRuns: 1000 },
    );
  });
});

describe("buildCacheBreakpoints", () => {
  const baseSchema = { type: "object", properties: { name: { type: "string" } } };

  it("15. same input produces same hash", () => {
    const a = buildCacheBreakpoints({
      schemaJson: baseSchema,
      systemPrompt: "Extract the data.",
      examples: [{ in: "x", out: "y" }],
    });
    const b = buildCacheBreakpoints({
      schemaJson: { properties: { name: { type: "string" } }, type: "object" },
      systemPrompt: "Extract the data.",
      examples: [{ in: "x", out: "y" }],
    });
    expect(a.breakpointId).toBe(b.breakpointId);
    expect(a.prefix).toBe(b.prefix);
  });

  it("16. different schemaJson produces different hash", () => {
    const a = buildCacheBreakpoints({
      schemaJson: baseSchema,
      systemPrompt: "p",
    });
    const b = buildCacheBreakpoints({
      schemaJson: { type: "object", properties: { age: { type: "number" } } },
      systemPrompt: "p",
    });
    expect(a.breakpointId).not.toBe(b.breakpointId);
  });

  it("17. different systemPrompt produces different hash", () => {
    const a = buildCacheBreakpoints({
      schemaJson: baseSchema,
      systemPrompt: "Extract A.",
    });
    const b = buildCacheBreakpoints({
      schemaJson: baseSchema,
      systemPrompt: "Extract B.",
    });
    expect(a.breakpointId).not.toBe(b.breakpointId);
  });

  it("18. examples reordered produces DIFFERENT hash (positional)", () => {
    const ex1 = { in: "1", out: "one" };
    const ex2 = { in: "2", out: "two" };
    const a = buildCacheBreakpoints({
      schemaJson: baseSchema,
      systemPrompt: "p",
      examples: [ex1, ex2],
    });
    const b = buildCacheBreakpoints({
      schemaJson: baseSchema,
      systemPrompt: "p",
      examples: [ex2, ex1],
    });
    expect(a.breakpointId).not.toBe(b.breakpointId);
  });

  it("19. prefixBytes matches actual UTF-8 byte length", () => {
    const out = buildCacheBreakpoints({
      schemaJson: { type: "object" },
      systemPrompt: "Extract héllo 🎉",
      examples: [{ unicode: "日本語" }],
    });
    expect(out.prefixBytes).toBe(Buffer.byteLength(out.prefix, "utf8"));
    // Sanity: hash is sha256 hex of the prefix.
    const expected = createHash("sha256").update(out.prefix, "utf8").digest("hex");
    expect(out.breakpointId).toBe(expected);
    expect(out.breakpointId).toMatch(/^[0-9a-f]{64}$/);
  });

  it("20. snapshot: pinned hash for fixed input", () => {
    const out = buildCacheBreakpoints({
      schemaJson: {
        type: "object",
        properties: {
          name: { type: "string" },
          age: { type: "number" },
        },
        required: ["name"],
      },
      systemPrompt: "You are an extraction model. Output JSON.",
      examples: [
        { input: "Alice is 30", output: { name: "Alice", age: 30 } },
        { input: "Bob", output: { name: "Bob" } },
      ],
    });
    // Pin both the prefix and the hash. If either changes, every cached
    // prefix in production becomes invalidated — this test catches that.
    expect(out.breakpointId).toBe(
      "e8cdc41eb476a9bf97fe26b802092b746c13d55ef2a85984beddf3185c01b440",
    );
    expect(out.prefix).toBe(
      [
        "<system>",
        "You are an extraction model. Output JSON.",
        "</system>",
        "<schema>",
        '{"properties":{"age":{"type":"number"},"name":{"type":"string"}},"required":["name"],"type":"object"}',
        "</schema>",
        "<examples>",
        '[{"input":"Alice is 30","output":{"age":30,"name":"Alice"}},{"input":"Bob","output":{"name":"Bob"}}]',
        "</examples>",
      ].join("\n"),
    );
    expect(out.prefixBytes).toBe(305);
  });
});
