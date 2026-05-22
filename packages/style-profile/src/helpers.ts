/**
 * StyleProfile helpers.
 *
 * Three small utilities the rest of the system needs:
 *   - `mergeProfiles`        : deep-merge a partial override onto a base.
 *   - `toCssVariables`       : flatten to CSS custom properties for the
 *                              web editor's live preview.
 *   - `profileToDocxRunOptions`: placeholder stub. The real docx-export
 *     mapping is Phase B's job — left as a typed function with a TODO so
 *     the call sites can be written ahead of the implementation.
 */

import type { StyleProfile } from "./types.js";

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

/**
 * Deep-merge `override` onto `base`. Object keys recurse; everything else
 * (numbers, strings) takes the override value. Arrays — there are none in
 * StyleProfile — would be replaced wholesale if added later.
 */
export function mergeProfiles(
  base: StyleProfile,
  override: DeepPartial<StyleProfile>,
): StyleProfile {
  return deepMerge(base, override) as StyleProfile;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function deepMerge(base: unknown, override: unknown): unknown {
  if (override === undefined) return base;
  if (!isPlainObject(base) || !isPlainObject(override)) return override;
  const result: Record<string, unknown> = { ...base };
  for (const key of Object.keys(override)) {
    result[key] = deepMerge(base[key], override[key]);
  }
  return result;
}

/**
 * Flatten a StyleProfile to CSS custom properties.
 *
 * Naming convention: `--glyph-{group}-{key}`, kebab-case for compound
 * names (e.g. `--glyph-spacing-line-height`). Numeric values that
 * represent CSS lengths are emitted with explicit `px` so consumers can
 * drop the values into any CSS property without string-concat.
 */
export function toCssVariables(profile: StyleProfile): Record<string, string> {
  const vars: Record<string, string> = {
    "--glyph-font-heading": profile.fonts.heading,
    "--glyph-font-body": profile.fonts.body,
    "--glyph-font-mono": profile.fonts.mono,
    "--glyph-color-text": profile.colors.text,
    "--glyph-color-accent": profile.colors.accent,
    "--glyph-color-muted": profile.colors.muted,
    "--glyph-color-background": profile.colors.background,
    "--glyph-size-h1": `${profile.sizes.h1}px`,
    "--glyph-size-h2": `${profile.sizes.h2}px`,
    "--glyph-size-h3": `${profile.sizes.h3}px`,
    "--glyph-size-body": `${profile.sizes.body}px`,
    "--glyph-size-small": `${profile.sizes.small}px`,
    "--glyph-spacing-line-height": String(profile.spacing.line_height),
    "--glyph-spacing-paragraph-gap": `${profile.spacing.paragraph_gap}px`,
    "--glyph-page-margin-top": `${profile.page.margins.top}pt`,
    "--glyph-page-margin-right": `${profile.page.margins.right}pt`,
    "--glyph-page-margin-bottom": `${profile.page.margins.bottom}pt`,
    "--glyph-page-margin-left": `${profile.page.margins.left}pt`,
  };
  return vars;
}

/**
 * Stubbed docx run-options factory.
 *
 * TODO(phase-b): wire to `docx` package — return `IRunOptions` derived
 * from the profile (font, size in half-points, color hex without `#`,
 * etc.) keyed by `kind`. Intentionally empty for Phase A.1 so call
 * sites can be drafted against a typed signature.
 */
export type DocxRunKind = "heading" | "body" | "mono";

export interface DocxRunOptionsStub {
  /** Family name fed to docx `Run({ font })`. */
  font: string;
  /** Font size in half-points (docx convention). */
  sizeHalfPoints: number;
  /** Hex color WITHOUT leading `#` (docx convention). */
  color: string;
}

export function profileToDocxRunOptions(
  profile: StyleProfile,
  kind: DocxRunKind,
): DocxRunOptionsStub {
  // TODO(phase-b): replace this stub with the real mapping. We return a
  // plausible shape so the import surface is stable for downstream code.
  const font =
    kind === "heading"
      ? profile.fonts.heading
      : kind === "mono"
        ? profile.fonts.mono
        : profile.fonts.body;
  const pxSize =
    kind === "heading" ? profile.sizes.h1 : profile.sizes.body;
  return {
    font,
    sizeHalfPoints: pxSize * 2,
    color: profile.colors.text.replace(/^#/, ""),
  };
}
