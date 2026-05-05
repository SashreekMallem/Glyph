import { describe, it, expect } from "vitest";
import { z } from "zod";
import * as fc from "fast-check";

import {
  encode,
  decode,
  isEaseEncoded,
  nextKey,
  allocateKey,
  type EaseEncoded,
} from "../src/ease";
import { ResumeSchema } from "@glyph/schema-library";

// ---------------------------------------------------------------------------
// 1. Encode flat array
// ---------------------------------------------------------------------------

describe("encode", () => {
  it("encodes a flat array of strings into an EASE container", () => {
    const schema = z.object({ tags: z.array(z.string()) });
    const input = { tags: ["a", "b", "c"] };
    const encoded = encode(input, schema) as { tags: EaseEncoded };

    expect(isEaseEncoded(encoded.tags)).toBe(true);
    expect(encoded.tags.display_order).toEqual([
      "item_0001",
      "item_0002",
      "item_0003",
    ]);
    expect(encoded.tags.item_0001).toBe("a");
    expect(encoded.tags.item_0002).toBe("b");
    expect(encoded.tags.item_0003).toBe("c");
  });

  it("encodes empty arrays into empty EASE containers", () => {
    const schema = z.object({ tags: z.array(z.string()) });
    const encoded = encode({ tags: [] }, schema) as { tags: EaseEncoded };

    expect(isEaseEncoded(encoded.tags)).toBe(true);
    expect(encoded.tags.display_order).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 2. Decode
// ---------------------------------------------------------------------------

describe("decode", () => {
  it("decodes an EASE container back to a plain array", () => {
    const schema = z.object({ tags: z.array(z.string()) });
    const encoded = {
      tags: {
        __ease__: true,
        display_order: ["item_0001", "item_0002"],
        item_0001: "x",
        item_0002: "y",
      },
    };
    const decoded = decode(encoded, schema) as { tags: string[] };
    expect(decoded.tags).toEqual(["x", "y"]);
  });

  it("respects display_order when decoding (out-of-order keys)", () => {
    const schema = z.object({ tags: z.array(z.string()) });
    const encoded = {
      tags: {
        __ease__: true,
        display_order: ["item_0002", "item_0001"],
        item_0001: "first",
        item_0002: "second",
      },
    };
    const decoded = decode(encoded, schema) as { tags: string[] };
    expect(decoded.tags).toEqual(["second", "first"]);
  });

  it("ignores orphan keys not in display_order", () => {
    const schema = z.object({ tags: z.array(z.string()) });
    const encoded = {
      tags: {
        __ease__: true,
        display_order: ["item_0001"],
        item_0001: "alive",
        item_0002: "dead",
      },
    };
    const decoded = decode(encoded, schema) as { tags: string[] };
    expect(decoded.tags).toEqual(["alive"]);
  });
});

// ---------------------------------------------------------------------------
// 3-7. Round-trip tests
// ---------------------------------------------------------------------------

describe("round-trip", () => {
  it("simple array of strings", () => {
    const schema = z.object({ tags: z.array(z.string()) });
    const input = { tags: ["a", "b", "c"] };
    expect(decode(encode(input, schema), schema)).toEqual(input);
  });

  it("array of objects", () => {
    const schema = z.object({
      experience: z.array(z.object({ company: z.string(), title: z.string() })),
    });
    const input = {
      experience: [
        { company: "Acme", title: "Engineer" },
        { company: "Beta", title: "Manager" },
      ],
    };
    expect(decode(encode(input, schema), schema)).toEqual(input);
  });

  it("nested arrays (matrix)", () => {
    const schema = z.object({
      matrix: z.array(z.array(z.number())),
    });
    const input = {
      matrix: [
        [1, 2],
        [3, 4],
        [5, 6],
      ],
    };
    expect(decode(encode(input, schema), schema)).toEqual(input);
  });

  it("object with multiple array fields", () => {
    const schema = z.object({
      a: z.array(z.string()),
      b: z.array(z.number()),
      c: z.string(),
    });
    const input = { a: ["x", "y"], b: [1, 2, 3], c: "hello" };
    expect(decode(encode(input, schema), schema)).toEqual(input);
  });

  it("array nested inside object inside array", () => {
    const schema = z.object({
      groups: z.array(
        z.object({ name: z.string(), members: z.array(z.string()) }),
      ),
    });
    const input = {
      groups: [
        { name: "alpha", members: ["a", "b"] },
        { name: "beta", members: [] },
        { name: "gamma", members: ["c"] },
      ],
    };
    expect(decode(encode(input, schema), schema)).toEqual(input);
  });
});

// ---------------------------------------------------------------------------
// 8. Empty array → empty EASE
// ---------------------------------------------------------------------------

describe("empty arrays", () => {
  it("produces an empty EASE container", () => {
    const schema = z.array(z.string());
    const encoded = encode([], schema) as EaseEncoded;
    expect(encoded).toEqual({ __ease__: true, display_order: [] });
  });

  it("decodes empty EASE container back to empty array", () => {
    const schema = z.array(z.string());
    expect(decode({ __ease__: true, display_order: [] }, schema)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 9-11. Optional / nullable / unions
// ---------------------------------------------------------------------------

describe("optional / nullable / unions", () => {
  it("optional array is undefined-safe", () => {
    const schema = z.object({ tags: z.array(z.string()).optional() });
    const input = {};
    const encoded = encode(input, schema);
    expect(encoded).toEqual({});
    expect(decode(encoded, schema)).toEqual({});
  });

  it("optional array round-trips when present", () => {
    const schema = z.object({ tags: z.array(z.string()).optional() });
    const input = { tags: ["a"] };
    expect(decode(encode(input, schema), schema)).toEqual(input);
  });

  it("nullable array passes null through", () => {
    const schema = z.object({ tags: z.array(z.string()).nullable() });
    const input = { tags: null };
    const encoded = encode(input, schema);
    expect(encoded).toEqual({ tags: null });
    expect(decode(encoded, schema)).toEqual({ tags: null });
  });

  it("nullable array round-trips when present", () => {
    const schema = z.object({ tags: z.array(z.string()).nullable() });
    const input = { tags: ["a", "b"] };
    expect(decode(encode(input, schema), schema)).toEqual(input);
  });

  it("default-wrapped array round-trips", () => {
    const schema = z.object({
      tags: z.array(z.string()).default([]),
    });
    const input = { tags: ["a"] };
    expect(decode(encode(input, schema), schema)).toEqual(input);
  });

  it("ZodEffects (refine) wrapped array round-trips", () => {
    const schema = z.object({
      tags: z.array(z.string()).refine((v) => v.length >= 0),
    });
    const input = { tags: ["a", "b"] };
    expect(decode(encode(input, schema), schema)).toEqual(input);
  });

  it("union type containing an array — array branch", () => {
    const schema = z.object({
      value: z.union([z.string(), z.array(z.number())]),
    });
    const input = { value: [1, 2, 3] };
    const encoded = encode(input, schema) as { value: EaseEncoded | string };
    expect(isEaseEncoded(encoded.value)).toBe(true);
    expect(decode(encoded, schema)).toEqual(input);
  });

  it("union type containing an array — string branch", () => {
    const schema = z.object({
      value: z.union([z.string(), z.array(z.number())]),
    });
    const input = { value: "hello" };
    const encoded = encode(input, schema);
    expect(encoded).toEqual({ value: "hello" });
    expect(decode(encoded, schema)).toEqual(input);
  });

  it("discriminated union round-trips", () => {
    const schema = z.object({
      shape: z.discriminatedUnion("type", [
        z.object({ type: z.literal("list"), items: z.array(z.string()) }),
        z.object({ type: z.literal("scalar"), value: z.number() }),
      ]),
    });
    const input = { shape: { type: "list" as const, items: ["a", "b"] } };
    expect(decode(encode(input, schema), schema)).toEqual(input);
  });
});

// ---------------------------------------------------------------------------
// 12-13. Idempotence
// ---------------------------------------------------------------------------

describe("idempotence", () => {
  it("encode(encode(x)) === encode(x)", () => {
    const schema = z.object({
      experience: z.array(z.object({ company: z.string() })),
    });
    const input = { experience: [{ company: "Acme" }, { company: "Beta" }] };
    const once = encode(input, schema);
    const twice = encode(once, schema);
    expect(twice).toEqual(once);
  });

  it("decode(decode(x)) === decode(x)", () => {
    const schema = z.object({
      experience: z.array(z.object({ company: z.string() })),
    });
    const input = { experience: [{ company: "Acme" }, { company: "Beta" }] };
    const once = decode(encode(input, schema), schema);
    const twice = decode(once, schema);
    expect(twice).toEqual(once);
  });
});

// ---------------------------------------------------------------------------
// 14-16. Key minting & allocation
// ---------------------------------------------------------------------------

describe("nextKey", () => {
  it("returns item_0001 for an empty container", () => {
    const empty: EaseEncoded = { __ease__: true, display_order: [] };
    expect(nextKey(empty)).toBe("item_0001");
  });

  it("returns max+1 even when display_order has gaps", () => {
    const c: EaseEncoded = {
      __ease__: true,
      display_order: ["item_0001", "item_0005"],
      item_0001: "a",
      item_0005: "e",
    };
    expect(nextKey(c)).toBe("item_0006");
  });

  it("considers orphaned keys when computing max", () => {
    // item_0009 is orphaned (not in display_order). nextKey should still
    // skip past it so we never reuse a previously-minted id.
    const c: EaseEncoded = {
      __ease__: true,
      display_order: ["item_0001"],
      item_0001: "a",
      item_0009: "orphan",
    };
    expect(nextKey(c)).toBe("item_0010");
  });
});

describe("allocateKey", () => {
  it("returns a new container with the new key appended to display_order", () => {
    const c: EaseEncoded = {
      __ease__: true,
      display_order: ["item_0001"],
      item_0001: "a",
    };
    const { key, container } = allocateKey(c);
    expect(key).toBe("item_0002");
    expect(container.display_order).toEqual(["item_0001", "item_0002"]);
    // Original is untouched
    expect(c.display_order).toEqual(["item_0001"]);
  });

  it("works on an empty container", () => {
    const empty: EaseEncoded = { __ease__: true, display_order: [] };
    const { key, container } = allocateKey(empty);
    expect(key).toBe("item_0001");
    expect(container.display_order).toEqual(["item_0001"]);
  });
});

// ---------------------------------------------------------------------------
// 17. isEaseEncoded type guard
// ---------------------------------------------------------------------------

describe("isEaseEncoded", () => {
  it("recognises a valid EASE container", () => {
    expect(isEaseEncoded({ __ease__: true, display_order: [] })).toBe(true);
    expect(
      isEaseEncoded({
        __ease__: true,
        display_order: ["item_0001"],
        item_0001: "x",
      }),
    ).toBe(true);
  });

  it("rejects plain arrays, plain objects, primitives, null", () => {
    expect(isEaseEncoded([])).toBe(false);
    expect(isEaseEncoded({})).toBe(false);
    expect(isEaseEncoded({ display_order: [] })).toBe(false);
    expect(isEaseEncoded({ __ease__: true })).toBe(false);
    expect(isEaseEncoded({ __ease__: false, display_order: [] })).toBe(false);
    expect(isEaseEncoded(null)).toBe(false);
    expect(isEaseEncoded(undefined)).toBe(false);
    expect(isEaseEncoded("foo")).toBe(false);
    expect(isEaseEncoded(42)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 18. Property test against the resume schema
// ---------------------------------------------------------------------------

// Build small arbitraries by hand.
const dateString = fc
  .tuple(
    fc.integer({ min: 1990, max: 2030 }),
    fc.integer({ min: 1, max: 12 }),
    fc.integer({ min: 1, max: 28 }),
  )
  .map(
    ([y, m, d]) =>
      `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
  );

const nonEmpty = fc.string({ minLength: 1, maxLength: 12 }).filter(
  (s) => s.trim().length > 0,
);

const personalArb = fc.record({
  full_name: nonEmpty,
  email: fc
    .tuple(nonEmpty, nonEmpty)
    .map(([a, b]) => `${a.replace(/[^a-zA-Z0-9]/g, "x")}@${b.replace(/[^a-zA-Z0-9]/g, "x")}.com`),
});

const experienceArb = fc.record({
  company: nonEmpty,
  title: nonEmpty,
  start_date: dateString,
  description: nonEmpty,
});

const educationArb = fc.record({
  institution: nonEmpty,
  degree: nonEmpty,
});

const skillGroupArb = fc.record({
  category: nonEmpty,
  items: fc.array(nonEmpty, { minLength: 1, maxLength: 3 }),
});

const resumeArb = fc.record({
  document_type: fc.constant("resume" as const),
  schema_version: fc.constant("1.0.0"),
  personal: personalArb,
  experience: fc.array(experienceArb, { minLength: 0, maxLength: 3 }),
  education: fc.array(educationArb, { minLength: 0, maxLength: 2 }),
  skills: fc.array(skillGroupArb, { minLength: 0, maxLength: 2 }),
});

describe("property: resume schema round-trip", () => {
  it("encode then decode preserves data over 1000 iterations", () => {
    fc.assert(
      fc.property(resumeArb, (resume) => {
        // Sanity: the arbitrary should produce schema-valid data.
        const parsed = ResumeSchema.safeParse(resume);
        if (!parsed.success) return; // skip — arbitrary occasionally falls outside schema (e.g. email regex)

        const encoded = encode(resume, ResumeSchema);
        const decoded = decode(encoded, ResumeSchema);
        expect(decoded).toEqual(resume);
      }),
      { numRuns: 1000 },
    );
  });
});
