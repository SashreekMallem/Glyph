import { Mark, mergeAttributes } from "@tiptap/core";

/**
 * GlyphFieldMark — a Tiptap mark that wraps a span of text with metadata
 * indicating it's a Glyph-extracted field.
 *
 * Stored on the document model, exported in HTML / Markdown / .docx, and
 * consumed by the side panel via the `data-glyph-field` attribute. Click
 * a card in the side panel → querySelector on this attribute → scrollIntoView.
 *
 * Visual treatment lives in `editor/styles.css` so dark mode stays clean.
 */

export interface GlyphFieldAttrs {
  /** Dot-notation path, e.g. "personal.full_name" */
  path: string | null;
  /** First 16 hex chars of sha256 over the normalized text. */
  fingerprint?: string | null;
  /** Whether the most recent signature verification passed. */
  verified?: boolean | null;
  /** Source-text region [start, end). Used by the sync endpoint. */
  region?: [number, number] | null;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    glyphField: {
      setGlyphField: (attrs: GlyphFieldAttrs) => ReturnType;
      unsetGlyphField: () => ReturnType;
      toggleGlyphField: (attrs: GlyphFieldAttrs) => ReturnType;
    };
  }
}

export const GlyphFieldMark = Mark.create<{
  HTMLAttributes: Record<string, unknown>;
}>({
  name: "glyphField",
  inclusive: false,
  spanning: false,
  excludes: "",

  addOptions() {
    return { HTMLAttributes: {} };
  },

  addAttributes() {
    return {
      path: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-glyph-field"),
        renderHTML: (attrs) =>
          attrs.path ? { "data-glyph-field": String(attrs.path) } : {},
      },
      fingerprint: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-fp"),
        renderHTML: (attrs) =>
          attrs.fingerprint ? { "data-fp": String(attrs.fingerprint) } : {},
      },
      verified: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-verified") === "1",
        renderHTML: (attrs) =>
          attrs.verified !== null && attrs.verified !== undefined
            ? { "data-verified": attrs.verified ? "1" : "0" }
            : {},
      },
      region: {
        default: null,
        parseHTML: (el) => {
          const raw = el.getAttribute("data-region");
          if (!raw) return null;
          const parts = raw.split(",").map((s) => Number.parseInt(s, 10));
          if (parts.length !== 2 || parts.some((n) => Number.isNaN(n))) return null;
          return [parts[0], parts[1]] as [number, number];
        },
        renderHTML: (attrs) =>
          Array.isArray(attrs.region)
            ? { "data-region": attrs.region.join(",") }
            : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-glyph-field]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        class: "glyph-field",
      }),
      0,
    ];
  },

  addCommands() {
    return {
      setGlyphField:
        (attrs) =>
        ({ commands }) =>
          commands.setMark(this.name, attrs as unknown as Record<string, unknown>),
      unsetGlyphField:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
      toggleGlyphField:
        (attrs) =>
        ({ commands }) =>
          commands.toggleMark(this.name, attrs as unknown as Record<string, unknown>),
    };
  },
});

export default GlyphFieldMark;
