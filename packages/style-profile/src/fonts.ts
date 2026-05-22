/**
 * Allowed font families for StyleProfile fields.
 *
 * Split into two tiers:
 *   - WEB_SAFE_FONTS: ships with Windows / macOS / Office / Google Docs.
 *     Always renders correctly with no network fetch.
 *   - GOOGLE_FONTS:    curated subset of Google Fonts. The web editor
 *     pulls these from fonts.googleapis.com on demand. Picked to cover
 *     the typical document-authoring style space (sans, serif, mono,
 *     display) without bloating the picker — we intentionally do NOT
 *     ship all 1,500 Google Fonts.
 *
 * The UI surfaces `ALL_ALLOWED_FONTS` in the font picker; the API uses
 * `isAllowedFont` as a defense-in-depth check before persisting a
 * profile (a Zod refinement could enforce it, but allowing arbitrary
 * fonts at the type level keeps the door open for enterprise-supplied
 * licensed fonts that the runtime UI doesn't enumerate).
 */

export const WEB_SAFE_FONTS = [
  "Arial",
  "Helvetica",
  "Calibri",
  "Aptos",
  "Georgia",
  "Times New Roman",
  "Courier New",
  "Verdana",
  "Tahoma",
  "Trebuchet MS",
  "Palatino",
  "Garamond",
] as const;

/**
 * Curated Google Fonts allowlist.
 *
 * Selection rules:
 *   - Cover the four major use cases: sans, serif, mono, display.
 *   - Prefer families with multiple weights (200..900) so headings and
 *     body can come from the same family.
 *   - Include the Glyph Modern default (`JetBrains Mono`).
 *   - Include the IBM Plex family (sans / serif / mono) because they
 *     pair well across all three roles.
 *   - Skip novelty / handwriting fonts — those belong in a future
 *     "creative" tier, not in the document-styling default surface.
 */
export const GOOGLE_FONTS = [
  // Sans-serif (workhorse body / UI)
  "Inter",
  "Roboto",
  "Open Sans",
  "Lato",
  "Montserrat",
  "Source Sans Pro",
  "Nunito",
  "Nunito Sans",
  "Work Sans",
  "Poppins",
  "Raleway",
  "Karla",
  "Manrope",
  "DM Sans",
  "Public Sans",
  "Mulish",
  "IBM Plex Sans",
  // Serif (long-form reading)
  "Source Serif Pro",
  "Merriweather",
  "Crimson Text",
  "Crimson Pro",
  "PT Serif",
  "Playfair Display",
  "Lora",
  "Cormorant Garamond",
  "Libre Baskerville",
  "EB Garamond",
  "Spectral",
  "Bitter",
  "Vollkorn",
  "IBM Plex Serif",
  // Monospace (code blocks, technical reports)
  "JetBrains Mono",
  "Fira Code",
  "Source Code Pro",
  "Roboto Mono",
  "Space Mono",
  "IBM Plex Mono",
  "Inconsolata",
  // Display (covers / titles — used sparingly for headings)
  "Bebas Neue",
  "Oswald",
  "Archivo Black",
  "DM Serif Display",
  "Abril Fatface",
  "Fraunces",
  "Outfit",
  "Space Grotesk",
] as const;

export const ALL_ALLOWED_FONTS = [
  ...WEB_SAFE_FONTS,
  ...GOOGLE_FONTS,
] as const;

export type AllowedFont = (typeof ALL_ALLOWED_FONTS)[number];

export function isAllowedFont(name: string): boolean {
  return (ALL_ALLOWED_FONTS as readonly string[]).includes(name);
}
