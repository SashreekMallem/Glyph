/**
 * Built-in default style profile.
 *
 * "Glyph Modern" is the profile applied to any document that does not
 * have a saved profile attached. Editorial choice: Georgia for the
 * reading surface (excellent screen + print render at small sizes,
 * available on every OS so we never have to wait for a Google Fonts
 * fetch), emerald `#10b981` as the single accent color, generous
 * 1-inch margins (72pt) to match Word/Docs defaults.
 */

import type { StyleProfile } from "./types.js";

export const GLYPH_MODERN_PROFILE: StyleProfile = {
  name: "Glyph Modern",
  fonts: { heading: "Georgia", body: "Georgia", mono: "JetBrains Mono" },
  colors: {
    text: "#111111",
    accent: "#10b981",
    muted: "#888888",
    background: "#ffffff",
  },
  sizes: { h1: 28, h2: 22, h3: 18, body: 14, small: 11 },
  spacing: { line_height: 1.55, paragraph_gap: 8 },
  page: { margins: { top: 72, right: 72, bottom: 72, left: 72 } },
};
