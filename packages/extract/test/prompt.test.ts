import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { buildPrompt } from "../src/prompt.js";

const baseSchema = {
  type: "object",
  properties: {
    name: { type: "string" },
    age: { type: "number" },
  },
  required: ["name"],
};

const baseInput = {
  schemaJson: baseSchema,
  schemaVersion: "v1",
  currentEase: { name: null },
  textDelta: "Alice is 30",
  fullText: "Alice is 30",
  sessionId: "session-abc",
};

describe("buildPrompt — prefix stability", () => {
  it("1. prefix is byte-identical across two calls with same inputs", () => {
    const a = buildPrompt(baseInput);
    const b = buildPrompt(baseInput);
    expect(a.prefix).toBe(b.prefix);
    expect(a.cacheKey).toBe(b.cacheKey);
  });

  it("2. cacheKey is sha256(prefix)", () => {
    const out = buildPrompt(baseInput);
    const expected = createHash("sha256")
      .update(out.prefix, "utf8")
      .digest("hex");
    expect(out.cacheKey).toBe(expected);
    expect(out.cacheKey).toMatch(/^[0-9a-f]{64}$/);
  });

  it("3. prefix uses <system>/<schema>/<examples> framing", () => {
    const out = buildPrompt(baseInput);
    expect(out.prefix.startsWith("<system>\n")).toBe(true);
    expect(out.prefix).toContain("\n</system>\n<schema>\n");
    expect(out.prefix).toContain("\n</schema>\n<examples>\n");
    expect(out.prefix.endsWith("\n</examples>")).toBe(true);
  });
});

describe("buildPrompt — suffix variability", () => {
  it("4. suffix changes when textDelta changes but prefix stays identical", () => {
    const a = buildPrompt({ ...baseInput, textDelta: "first" });
    const b = buildPrompt({ ...baseInput, textDelta: "second" });
    expect(a.prefix).toBe(b.prefix);
    expect(a.cacheKey).toBe(b.cacheKey);
    expect(a.suffix).not.toBe(b.suffix);
    expect(a.suffix).toContain("first");
    expect(b.suffix).toContain("second");
  });

  it("5. suffix contains state, delta markers, and trailing instruction", () => {
    const out = buildPrompt(baseInput);
    expect(out.suffix).toContain("<state>");
    expect(out.suffix).toContain("</state>");
    expect(out.suffix).toContain("<<DELTA>>");
    expect(out.suffix).toContain("<<END_DELTA>>");
    expect(out.suffix).toContain(
      "Emit RFC 6902 patches as a JSON array. No prose.",
    );
  });

  it("6. fullText included when provided, omitted when not", () => {
    const withFull = buildPrompt({ ...baseInput, fullText: "FULL_DOC" });
    expect(withFull.suffix).toContain("<full>");
    expect(withFull.suffix).toContain("FULL_DOC");

    const withoutFull = buildPrompt({ ...baseInput, fullText: undefined });
    expect(withoutFull.suffix).not.toContain("<full>");
  });

  it("7. fullText is tail-truncated to ~8000 chars", () => {
    const big = "x".repeat(20000) + "TAIL_MARKER";
    const out = buildPrompt({ ...baseInput, fullText: big });
    expect(out.suffix).toContain("TAIL_MARKER");
    // Body of <full> block should be at most 8000 chars.
    const m = out.suffix.match(/<full>\n([\s\S]*?)\n<\/full>/);
    expect(m).not.toBeNull();
    expect(m![1].length).toBeLessThanOrEqual(8000);
  });
});

describe("buildPrompt — cacheKey invalidation", () => {
  it("8. cacheKey changes when schemaVersion changes", () => {
    const a = buildPrompt({ ...baseInput, schemaVersion: "v1" });
    const b = buildPrompt({ ...baseInput, schemaVersion: "v2" });
    expect(a.cacheKey).not.toBe(b.cacheKey);
    expect(a.prefix).not.toBe(b.prefix);
  });

  it("9. cacheKey changes when schemaJson changes", () => {
    const a = buildPrompt(baseInput);
    const b = buildPrompt({
      ...baseInput,
      schemaJson: { ...baseSchema, properties: { other: { type: "string" } } },
    });
    expect(a.cacheKey).not.toBe(b.cacheKey);
  });

  it("10. cacheKey unaffected by currentEase, textDelta, fullText, sessionId", () => {
    const base = buildPrompt(baseInput);
    const variants = [
      { ...baseInput, currentEase: { totally: "different" } },
      { ...baseInput, textDelta: "wildly different delta content" },
      { ...baseInput, fullText: "different full text" },
      { ...baseInput, fullText: undefined },
      { ...baseInput, sessionId: "different-session-xyz" },
    ];
    for (const v of variants) {
      const out = buildPrompt(v);
      expect(out.cacheKey).toBe(base.cacheKey);
      expect(out.prefix).toBe(base.prefix);
    }
  });

  it("11. cacheKey changes when examples override changes", () => {
    const a = buildPrompt({ ...baseInput, examples: [{ a: 1 }] });
    const b = buildPrompt({ ...baseInput, examples: [{ a: 2 }] });
    expect(a.cacheKey).not.toBe(b.cacheKey);
  });
});

describe("buildPrompt — stableStringify usage", () => {
  it("12. key order in schemaJson does NOT change cacheKey", () => {
    const a = buildPrompt({
      ...baseInput,
      schemaJson: {
        type: "object",
        properties: { name: { type: "string" }, age: { type: "number" } },
        required: ["name"],
      },
    });
    const b = buildPrompt({
      ...baseInput,
      schemaJson: {
        required: ["name"],
        properties: { age: { type: "number" }, name: { type: "string" } },
        type: "object",
      },
    });
    expect(a.cacheKey).toBe(b.cacheKey);
    expect(a.prefix).toBe(b.prefix);
  });

  it("13. key order in examples objects does NOT change cacheKey", () => {
    const a = buildPrompt({
      ...baseInput,
      examples: [{ in: "x", out: "y" }],
    });
    const b = buildPrompt({
      ...baseInput,
      examples: [{ out: "y", in: "x" }],
    });
    expect(a.cacheKey).toBe(b.cacheKey);
  });
});

describe("buildPrompt — regression pin", () => {
  it("14. pinned prefix sha256 for fixed minimal input", () => {
    // If this hash changes, every cached prefix in production is invalidated.
    // Update intentionally and audit the prefix delta when bumping.
    const out = buildPrompt({
      schemaJson: { type: "object", properties: { name: { type: "string" } } },
      schemaVersion: "v1",
      currentEase: {},
      textDelta: "",
      sessionId: "s1",
      examples: [],
    });
    expect(out.cacheKey).toBe(
      "fed7568c6e1e4dcea9d3da02d7f2c1af48ff2f689ca2512d91b7577148d9c25e",
    );
  });
});
