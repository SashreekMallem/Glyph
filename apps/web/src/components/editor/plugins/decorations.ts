/**
 * Bidirectional decoration plugin.
 *
 * Reads EASE-encoded extraction state from the upstream extract plugin
 * and renders inline decorations across the doc, one per extracted leaf
 * value. Each decoration carries a `data-glyph-path` attribute encoding
 * the RFC 6901 JSON Pointer to the value, so callers can map clicks back
 * to a field in the extraction tree.
 *
 * Pure: never dispatches. Re-derives only when the EASE pointer changes
 * (reference equality), so a stable upstream pointer trivially short-
 * circuits the rebuild.
 */

import { Plugin, PluginKey, type EditorState } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import { isEaseEncoded } from "@glyph/extract/client";

// Stable per-session color assignment (mirrors ExtractedFieldsPanel palette)
const PALETTE_SIZE = 8;
const keyColorMap = new Map<string, number>();

export interface ExtractDecorationsOptions {
  getEase: (state: EditorState) => object | null;
  onSelect?: (path: string) => void;
  className?: string;
}

interface PluginInternalState {
  ease: object | null;
  decorations: DecorationSet;
}

export const extractDecorationsPluginKey = new PluginKey<PluginInternalState>(
  "glyph-extract-decorations",
);

const DEFAULT_CLASS = "glyph-extract-highlight";

// ---------------------------------------------------------------------------
// JSON Pointer (RFC 6901) escaping
// ---------------------------------------------------------------------------

function escapeToken(token: string): string {
  // ~ -> ~0, / -> ~1. Order matters: encode ~ first, then /.
  return token.replace(/~/g, "~0").replace(/\//g, "~1");
}

// ---------------------------------------------------------------------------
// EASE walk
// ---------------------------------------------------------------------------

interface Leaf {
  path: string;
  value: unknown;
  textSpan: { start: number; end: number } | null;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function readTextSpan(
  v: unknown,
): { start: number; end: number } | null {
  if (!isPlainObject(v)) return null;
  const span = v.text_span;
  if (!isPlainObject(span)) return null;
  const start = span.start;
  const end = span.end;
  if (typeof start === "number" && typeof end === "number" && end >= start) {
    return { start, end };
  }
  return null;
}

/**
 * Returns `{ value, span }` for a leaf-like node. A leaf may be:
 *   - a primitive (string/number/boolean/null) — no inline span
 *   - an object of the form `{ value, text_span }` produced by the model
 * In the latter case we surface both the inner value and the span.
 */
function readWrappedLeaf(
  v: unknown,
): { value: unknown; span: { start: number; end: number } | null } | null {
  if (!isPlainObject(v)) return null;
  if (!("value" in v) || !("text_span" in v)) return null;
  // Don't treat as a leaf if `value` itself is structured; that's a
  // nested EASE / object subtree.
  const inner = v.value;
  if (isPlainObject(inner) || Array.isArray(inner)) return null;
  return { value: inner, span: readTextSpan(v) };
}

function isPrimitive(v: unknown): boolean {
  return (
    v === null ||
    typeof v === "string" ||
    typeof v === "number" ||
    typeof v === "boolean"
  );
}

function walk(value: unknown, pointer: string, out: Leaf[]): void {
  if (value === undefined) return;

  // Wrapped leaf: { value, text_span }
  const wrapped = readWrappedLeaf(value);
  if (wrapped) {
    out.push({ path: pointer, value: wrapped.value, textSpan: wrapped.span });
    return;
  }

  // Primitive leaf
  if (isPrimitive(value)) {
    out.push({ path: pointer, value, textSpan: null });
    return;
  }

  // EASE-encoded array container
  if (isEaseEncoded(value)) {
    for (const key of value.display_order) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
      walk(value[key], `${pointer}/${escapeToken(key)}`, out);
    }
    return;
  }

  // Plain object
  if (isPlainObject(value)) {
    for (const [k, v] of Object.entries(value)) {
      walk(v, `${pointer}/${escapeToken(k)}`, out);
    }
    return;
  }

  // Plain array (non-EASE) — fall back to numeric indices.
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      walk(value[i], `${pointer}/${i}`, out);
    }
  }
}

// ---------------------------------------------------------------------------
// Decoration construction
// ---------------------------------------------------------------------------

function fuzzyLocate(
  docText: string,
  needleRaw: unknown,
): { start: number; end: number } | null {
  if (typeof needleRaw !== "string") return null;
  const needle = needleRaw.trim();
  if (needle.length === 0) return null;
  const hay = docText.toLowerCase();
  const idx = hay.indexOf(needle.toLowerCase());
  if (idx < 0) return null;
  return { start: idx, end: idx + needle.length };
}

function buildDecorations(
  state: EditorState,
  ease: object | null,
  className: string,
): DecorationSet {
  if (!ease) return DecorationSet.empty;

  const leaves: Leaf[] = [];
  walk(ease, "", leaves);
  if (leaves.length === 0) return DecorationSet.empty;

  const doc = state.doc;
  const docSize = doc.content.size;
  // textBetween gives us a flat string indexed in *text* coordinates,
  // not PM positions. We use the same call to scan; ProseMirror's
  // inline decorations also accept document positions, so for fuzzy
  // matches we walk the doc node-by-node to convert text offsets to
  // doc positions.
  let docText = "";
  // Map from textOffset -> docPos. We accumulate as we walk text nodes.
  const offsets: Array<{ textOffset: number; docPos: number; len: number }> =
    [];
  doc.descendants((node, pos) => {
    if (node.isText) {
      offsets.push({
        textOffset: docText.length,
        docPos: pos,
        len: node.text?.length ?? 0,
      });
      docText += node.text ?? "";
    }
    return true;
  });

  function textOffsetToDocPos(off: number): number | null {
    // Find the segment containing `off`.
    for (const seg of offsets) {
      if (off >= seg.textOffset && off <= seg.textOffset + seg.len) {
        return seg.docPos + (off - seg.textOffset);
      }
    }
    return null;
  }

  const decos: Decoration[] = [];
  for (const leaf of leaves) {
    let span = leaf.textSpan;
    if (
      span &&
      (span.start < 0 || span.end > docSize || span.end <= span.start)
    ) {
      span = null;
    }
    let from: number | null = null;
    let to: number | null = null;

    if (span) {
      // text_span is given in text coords (per the model contract).
      from = textOffsetToDocPos(span.start);
      to = textOffsetToDocPos(span.end);
    } else {
      const located = fuzzyLocate(docText, leaf.value);
      if (located) {
        from = textOffsetToDocPos(located.start);
        to = textOffsetToDocPos(located.end);
      }
    }
    if (from === null || to === null || to <= from) continue;
    const topKey = leaf.path.split("/").filter(Boolean)[0] ?? "";
    // Assign a stable color index per top-level key
    if (!keyColorMap.has(topKey)) {
      keyColorMap.set(topKey, keyColorMap.size % PALETTE_SIZE);
    }
    const colorIdx = keyColorMap.get(topKey)!;
    decos.push(
      Decoration.inline(
        from,
        to,
        {
          class: className,
          "data-glyph-path": leaf.path,
          "data-field": topKey,
          "data-color": String(colorIdx),
        },
        { glyphPath: leaf.path, glyphField: topKey, glyphColor: colorIdx },
      ),
    );
  }
  return DecorationSet.create(doc, decos);
}

// ---------------------------------------------------------------------------
// Public lookup helper
// ---------------------------------------------------------------------------

export function findPathAtPos(
  state: EditorState,
  pos: number,
): string | null {
  const ps = extractDecorationsPluginKey.getState(state);
  if (!ps) return null;
  const found = ps.decorations.find(pos, pos);
  for (const d of found) {
    const spec = (d as unknown as { spec?: { glyphPath?: unknown } }).spec;
    const path = spec?.glyphPath;
    if (typeof path === "string") return path;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export function extractDecorationsPlugin(
  options: ExtractDecorationsOptions,
): Plugin<PluginInternalState> {
  const className = options.className ?? DEFAULT_CLASS;

  return new Plugin<PluginInternalState>({
    key: extractDecorationsPluginKey,
    state: {
      init(_config, state) {
        const ease = options.getEase(state);
        return {
          ease,
          decorations: buildDecorations(state, ease, className),
        };
      },
      apply(tr, prev, _oldState, newState) {
        const nextEase = options.getEase(newState);
        // Reference-equality cache: same EASE pointer + no doc change ⇒
        // reuse previous DecorationSet object identity.
        if (nextEase === prev.ease && !tr.docChanged) {
          return prev;
        }
        // Doc changed but EASE pointer is stable: just map positions.
        if (nextEase === prev.ease && tr.docChanged) {
          return {
            ease: prev.ease,
            decorations: prev.decorations.map(tr.mapping, tr.doc),
          };
        }
        return {
          ease: nextEase,
          decorations: buildDecorations(newState, nextEase, className),
        };
      },
    },
    props: {
      decorations(state) {
        return extractDecorationsPluginKey.getState(state)?.decorations;
      },
      handleClick(view, pos) {
        const path = findPathAtPos(view.state, pos);
        if (path !== null && options.onSelect) {
          options.onSelect(path);
          return true;
        }
        return false;
      },
    },
  });
}
