import { describe, expect, it } from "vitest";
import {
  GLYPH_MODERN_PROFILE,
  profileFontFor,
  profileToDocxRun,
  profileToRgb,
} from "../src/index.js";

describe("profileToDocxRun", () => {
  it("uses heading font + h1 size (half-points) for kind=h1", () => {
    const run = profileToDocxRun(GLYPH_MODERN_PROFILE, "h1");
    expect(run.font).toBe("Georgia");
    // sizes.h1 = 28 px → 56 half-points
    expect(run.size).toBe(GLYPH_MODERN_PROFILE.sizes.h1 * 2);
    expect(run.color).toBe("111111"); // no leading "#"
  });

  it("uses body font + body size for kind=body", () => {
    const run = profileToDocxRun(GLYPH_MODERN_PROFILE, "body");
    expect(run.font).toBe(GLYPH_MODERN_PROFILE.fonts.body);
    expect(run.size).toBe(GLYPH_MODERN_PROFILE.sizes.body * 2);
  });

  it("uses mono font + small size for kind=mono", () => {
    const run = profileToDocxRun(GLYPH_MODERN_PROFILE, "mono");
    expect(run.font).toBe("JetBrains Mono");
    expect(run.size).toBe(GLYPH_MODERN_PROFILE.sizes.small * 2);
  });

  it("differentiates h2 vs h3 sizes", () => {
    const h2 = profileToDocxRun(GLYPH_MODERN_PROFILE, "h2");
    const h3 = profileToDocxRun(GLYPH_MODERN_PROFILE, "h3");
    expect(h2.size).toBe(GLYPH_MODERN_PROFILE.sizes.h2 * 2);
    expect(h3.size).toBe(GLYPH_MODERN_PROFILE.sizes.h3 * 2);
    expect(h2.size).not.toBe(h3.size);
  });
});

describe("profileToRgb", () => {
  it("parses #111111 text into normalised RGB floats", () => {
    const rgb = profileToRgb(GLYPH_MODERN_PROFILE, "text");
    // 0x11 / 255 ≈ 0.0667
    expect(rgb.r).toBeCloseTo(0x11 / 255);
    expect(rgb.g).toBeCloseTo(0x11 / 255);
    expect(rgb.b).toBeCloseTo(0x11 / 255);
  });

  it("parses the emerald accent into expected channels", () => {
    const rgb = profileToRgb(GLYPH_MODERN_PROFILE, "accent");
    expect(rgb.r).toBeCloseTo(0x10 / 255);
    expect(rgb.g).toBeCloseTo(0xb9 / 255);
    expect(rgb.b).toBeCloseTo(0x81 / 255);
  });

  it("clamps every channel into [0, 1]", () => {
    const rgb = profileToRgb(GLYPH_MODERN_PROFILE, "muted");
    for (const v of [rgb.r, rgb.g, rgb.b]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("throws on a malformed hex (defensive runtime check)", () => {
    const bad = {
      ...GLYPH_MODERN_PROFILE,
      colors: { ...GLYPH_MODERN_PROFILE.colors, text: "not-a-hex" },
    };
    expect(() => profileToRgb(bad, "text")).toThrow();
  });
});

describe("profileFontFor", () => {
  it("returns the requested font family name", () => {
    expect(profileFontFor(GLYPH_MODERN_PROFILE, "heading")).toBe("Georgia");
    expect(profileFontFor(GLYPH_MODERN_PROFILE, "body")).toBe("Georgia");
    expect(profileFontFor(GLYPH_MODERN_PROFILE, "mono")).toBe("JetBrains Mono");
  });
});
