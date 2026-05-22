/**
 * Style profile schema.
 *
 * A StyleProfile is the visual-styling sidecar that travels alongside the
 * structural ProseMirror state and the structured Glyph payload. Storage
 * is structural-only by design (Glyph knows there is an `h2` heading, but
 * not that it should render as Aptos 24pt navy). The style profile fills
 * that gap so re-exports (.docx / .pdf / MCP `generate`) preserve the
 * author's visual intent instead of being re-styled from hardcoded defaults.
 *
 * Units:
 *   - `sizes.*` are font sizes in CSS pixels (the docx exporter converts to
 *     half-points; the PDF exporter converts to points).
 *   - `spacing.line_height` is unitless (CSS line-height).
 *   - `spacing.paragraph_gap` is pixels of vertical gap between paragraphs.
 *   - `page.margins.*` are in points (1pt = 1/72 inch) — chosen to map
 *     directly onto docx/PDF without extra conversion.
 *
 * Colors are 6-digit lowercase-or-uppercase hex (`#rrggbb`). Short hex
 * (`#rgb`) and alpha hex (`#rrggbbaa`) are intentionally rejected so we
 * never have to argue about how to render translucent text into a PDF.
 */

import { z } from "zod";

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const StyleProfileSchema = z.object({
  name: z.string().min(1).max(80),
  fonts: z.object({
    heading: z.string().min(1),
    body: z.string().min(1),
    mono: z.string().min(1),
  }),
  colors: z.object({
    text: hexColor,
    accent: hexColor,
    muted: hexColor,
    background: hexColor,
  }),
  sizes: z.object({
    h1: z.number().int().positive(),
    h2: z.number().int().positive(),
    h3: z.number().int().positive(),
    body: z.number().int().positive(),
    small: z.number().int().positive(),
  }),
  spacing: z.object({
    line_height: z.number().min(1).max(3),
    paragraph_gap: z.number().int().nonnegative(),
  }),
  page: z.object({
    margins: z.object({
      top: z.number().int().nonnegative(),
      right: z.number().int().nonnegative(),
      bottom: z.number().int().nonnegative(),
      left: z.number().int().nonnegative(),
    }),
  }),
});

export type StyleProfile = z.infer<typeof StyleProfileSchema>;
