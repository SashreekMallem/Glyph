import { describe, it, expect } from "vitest";
import { parsePartial, encode, decode, applyPatches } from "../src";

describe("@glyph/extract scaffolding", () => {
  it("exports lenient-parser", () => {
    expect(typeof parsePartial).toBe("function");
  });
  it("exports EASE encode/decode", () => {
    expect(typeof encode).toBe("function");
    expect(typeof decode).toBe("function");
  });
  it("exports patches", () => {
    expect(typeof applyPatches).toBe("function");
  });
});
