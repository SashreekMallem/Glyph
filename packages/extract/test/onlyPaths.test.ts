import { describe, it, expect } from "vitest";
import { buildPrompt } from "../src/prompt.js";

const baseInput = {
  schemaJson: { type: "object", properties: { name: { type: "string" } } },
  schemaVersion: "1.0",
  currentEase: {},
  textDelta: "John works at Acme",
  sessionId: "s1",
  examples: [],
};

describe("buildPrompt — onlyPaths", () => {
  it("cacheKey unchanged when onlyPaths added (prefix is byte-stable)", () => {
    const a = buildPrompt(baseInput);
    const b = buildPrompt({ ...baseInput, onlyPaths: ["personal.email"] });
    expect(a.cacheKey).toBe(b.cacheKey);
    expect(a.prefix).toBe(b.prefix);
  });

  it("focus_paths block lives in suffix only", () => {
    const out = buildPrompt({
      ...baseInput,
      onlyPaths: ["personal.email", "experience.0.company"],
    });
    expect(out.prefix).not.toContain("<focus_paths>");
    expect(out.suffix).toContain("<focus_paths>");
    expect(out.suffix).toContain("personal.email");
    expect(out.suffix).toContain("experience.0.company");
  });

  it("empty onlyPaths array → no focus_paths block", () => {
    const out = buildPrompt({ ...baseInput, onlyPaths: [] });
    expect(out.suffix).not.toContain("<focus_paths>");
  });

  it("undefined onlyPaths → no focus_paths block", () => {
    const out = buildPrompt({ ...baseInput, onlyPaths: undefined });
    expect(out.suffix).not.toContain("<focus_paths>");
  });

  it("focus_paths instructions reference srcStart/srcEnd", () => {
    const out = buildPrompt({ ...baseInput, onlyPaths: ["x"] });
    expect(out.suffix).toContain("srcStart");
    expect(out.suffix).toContain("srcEnd");
  });
});
