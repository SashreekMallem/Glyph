import { describe, expect, it } from "vitest";
import {
  GLYPH_MODERN_PROFILE,
  StyleProfileSchema,
  isAllowedFont,
  mergeProfiles,
  toCssVariables,
} from "../src/index.js";

describe("StyleProfileSchema", () => {
  it("parses the bundled Glyph Modern default", () => {
    const parsed = StyleProfileSchema.parse(GLYPH_MODERN_PROFILE);
    expect(parsed.name).toBe("Glyph Modern");
    expect(parsed.colors.accent).toBe("#10b981");
    expect(parsed.page.margins.left).toBe(72);
  });

  it("rejects a profile with a bad hex color", () => {
    const bad = {
      ...GLYPH_MODERN_PROFILE,
      colors: { ...GLYPH_MODERN_PROFILE.colors, accent: "10b981" },
    };
    expect(() => StyleProfileSchema.parse(bad)).toThrow();
  });

  it("rejects 3-digit shorthand hex (#fff) — only #rrggbb is allowed", () => {
    const bad = {
      ...GLYPH_MODERN_PROFILE,
      colors: { ...GLYPH_MODERN_PROFILE.colors, background: "#fff" },
    };
    expect(() => StyleProfileSchema.parse(bad)).toThrow();
  });

  it("rejects negative page margins", () => {
    const bad = {
      ...GLYPH_MODERN_PROFILE,
      page: { margins: { top: -1, right: 72, bottom: 72, left: 72 } },
    };
    expect(() => StyleProfileSchema.parse(bad)).toThrow();
  });

  it("rejects line-height outside [1, 3]", () => {
    const bad = {
      ...GLYPH_MODERN_PROFILE,
      spacing: { ...GLYPH_MODERN_PROFILE.spacing, line_height: 4 },
    };
    expect(() => StyleProfileSchema.parse(bad)).toThrow();
  });

  it("rejects an empty profile name", () => {
    const bad = { ...GLYPH_MODERN_PROFILE, name: "" };
    expect(() => StyleProfileSchema.parse(bad)).toThrow();
  });
});

describe("helpers", () => {
  it("mergeProfiles deep-merges override onto base", () => {
    const merged = mergeProfiles(GLYPH_MODERN_PROFILE, {
      name: "Branded",
      colors: { accent: "#ff0066" },
      sizes: { h1: 36 },
    });
    expect(merged.name).toBe("Branded");
    expect(merged.colors.accent).toBe("#ff0066");
    // Unchanged keys carry over from base.
    expect(merged.colors.text).toBe(GLYPH_MODERN_PROFILE.colors.text);
    expect(merged.sizes.h1).toBe(36);
    expect(merged.sizes.body).toBe(GLYPH_MODERN_PROFILE.sizes.body);
    // The result must still round-trip through the schema.
    expect(() => StyleProfileSchema.parse(merged)).not.toThrow();
  });

  it("toCssVariables emits kebab-case --glyph-* custom props", () => {
    const vars = toCssVariables(GLYPH_MODERN_PROFILE);
    expect(vars["--glyph-font-heading"]).toBe("Georgia");
    expect(vars["--glyph-color-accent"]).toBe("#10b981");
    expect(vars["--glyph-size-h1"]).toBe("28px");
    expect(vars["--glyph-spacing-line-height"]).toBe("1.55");
    expect(vars["--glyph-page-margin-top"]).toBe("72pt");
  });

  it("isAllowedFont recognises web-safe and curated Google Fonts", () => {
    expect(isAllowedFont("Georgia")).toBe(true);
    expect(isAllowedFont("JetBrains Mono")).toBe(true);
    expect(isAllowedFont("Inter")).toBe(true);
    expect(isAllowedFont("Comic Sans MS")).toBe(false);
  });
});
