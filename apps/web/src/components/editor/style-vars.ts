/**
 * Bridge between `@glyph/style-profile` and React's `CSSProperties`.
 *
 * `toCssVariables` returns a flat `Record<string, string>` of CSS custom
 * properties (`--glyph-font-body`, etc.). React's `style` prop accepts a
 * loose superset of CSS — including arbitrary `--*` custom properties —
 * but its typed surface is `CSSProperties`. The cast here is the one
 * place we acknowledge the gap so consumers can drop a profile straight
 * onto a `<div style={...}>` without ts-expect-error fluff at every call
 * site.
 */

import type { CSSProperties } from "react";

import { toCssVariables, type StyleProfile } from "@glyph/style-profile";

export function profileToStyleObject(profile: StyleProfile): CSSProperties {
  return toCssVariables(profile) as CSSProperties;
}
