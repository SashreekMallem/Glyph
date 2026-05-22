/**
 * Export helpers — bridge a StyleProfile into the unit systems used by
 * the two document renderers.
 *
 *   - docx-js (Word .docx)   wants font sizes in HALF-points and hex
 *                            colors WITHOUT the leading `#`.
 *   - pdf-lib (.pdf)         wants RGB channels as floats in [0, 1] and
 *                            font sizes in points natively.
 *
 * Page margins live in `StyleProfile.page.margins` in POINTS by
 * convention (chosen so PDF math is direct; docx must multiply by 20
 * to convert points → twentieths-of-a-point, which docx-js calls
 * `dxa`).
 *
 * The `docx` package is a PEER dependency of this module — we import
 * only the `IRunOptions` TYPE so the renderer's call sites get
 * structural compatibility without us pulling in a 6 MB graph at
 * runtime. Consumers that don't need docx output never load it.
 */

// `IRunOptions` is the docx-js run options shape. Imported type-only so
// the style-profile package never pulls docx into a non-docx consumer
// (e.g. the editor). We don't use the type as the return shape directly
// because `IRunOptions.size` is `number | PositiveUniversalMeasure` —
// callers want to do arithmetic on `size`, so we narrow it to `number`
// in our own return type. A compile-time spread check (below) keeps the
// shape compatible with docx-js's `new TextRun({...})`.
import type { IRunOptions } from "docx"; // type-only import — docx is a peer dep
import type { StyleProfile } from "./types.js";

/**
 * Narrowed run shape produced by {@link profileToDocxRun}. Compatible
 * with docx-js's `IRunOptions` (spread it into `new TextRun({...})`)
 * but uses plain `number` for `size` so callers can perform arithmetic
 * without unioning against `PositiveUniversalMeasure`.
 */
export interface ProfiledDocxRun {
  readonly font: string;
  readonly size: number;
  readonly color: string;
}

// Compile-time guard: if docx-js ever tightens IRunOptions in a way
// that makes `ProfiledDocxRun` no longer assignable, this assignment
// errors and we'll know to revisit.
type _AssertProfiledDocxRunAssignable = ProfiledDocxRun extends IRunOptions
  ? true
  : never;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _profiledDocxRunCheck: _AssertProfiledDocxRunAssignable = true;

/**
 * The set of element classes a docx run can represent. h1/h2/h3 use
 * the heading font and the matching `sizes.{h1,h2,h3}` value. `body`
 * uses the body font and `sizes.body`. `mono` uses the mono font and
 * `sizes.small` (code is conventionally tighter than body copy).
 *
 * Distinct from the legacy `DocxRunKind` in `helpers.ts` (which only
 * knew "heading | body | mono") — that kind survives for backward
 * compatibility with Phase A.1 call sites. New renderers should use
 * `DocxElementKind`.
 */
export type DocxElementKind = "h1" | "h2" | "h3" | "body" | "mono";

/**
 * Map a StyleProfile + element kind to the three docx-js fields the
 * renderer always touches: font family, size in half-points, and a
 * hex color with no leading `#`.
 *
 * The return type is a subset of `IRunOptions`; callers spread it
 * into a `new TextRun({ ...profileToDocxRun(...), text: "…" })`.
 */
export function profileToDocxRun(
  profile: StyleProfile,
  kind: DocxElementKind,
): ProfiledDocxRun {
  const fontKey: keyof StyleProfile["fonts"] =
    kind === "mono"
      ? "mono"
      : kind === "body"
        ? "body"
        : "heading";
  const sizeKey: keyof StyleProfile["sizes"] =
    kind === "h1"
      ? "h1"
      : kind === "h2"
        ? "h2"
        : kind === "h3"
          ? "h3"
          : kind === "mono"
            ? "small"
            : "body";
  return {
    font: profile.fonts[fontKey],
    // docx-js takes sizes in HALF-points — a 14pt run is `size: 28`.
    size: profile.sizes[sizeKey] * 2,
    // docx-js wants hex without the `#`.
    color: profile.colors.text.replace(/^#/, ""),
  };
}

/**
 * Color picker that returns pdf-lib-ready RGB floats (0..1) for the
 * three semantic colors a renderer typically needs: `text` (body),
 * `accent` (links / highlights), `muted` (footers, meta, secondary
 * lines). `background` is intentionally omitted — pdf-lib draws on a
 * white page and we never paint a background fill.
 */
export function profileToRgb(
  profile: StyleProfile,
  colorKey: "text" | "accent" | "muted",
): { r: number; g: number; b: number } {
  const hex = profile.colors[colorKey];
  return hexToRgb01(hex);
}

/**
 * Look up the family name for one of the three font roles a renderer
 * cares about. Sugar over `profile.fonts.<kind>` so call sites read
 * like "give me the body font for this profile".
 */
export function profileFontFor(
  profile: StyleProfile,
  kind: "heading" | "body" | "mono",
): string {
  return profile.fonts[kind];
}

// ---------------------------------------------------------------------------
// Internal: hex parser
// ---------------------------------------------------------------------------

function hexToRgb01(hex: string): { r: number; g: number; b: number } {
  // StyleProfileSchema already constrains this to `#RRGGBB`, but we
  // re-check defensively because this helper may be called with raw
  // strings during testing.
  const match = /^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/.exec(hex);
  if (!match) {
    throw new Error(
      `profileToRgb: expected #RRGGBB hex color, got ${JSON.stringify(hex)}`,
    );
  }
  const r = parseInt(match[1]!, 16) / 255;
  const g = parseInt(match[2]!, 16) / 255;
  const b = parseInt(match[3]!, 16) / 255;
  return { r, g, b };
}
