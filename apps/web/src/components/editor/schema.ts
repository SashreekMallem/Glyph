/**
 * Glyph editor ProseMirror schema — prose-first.
 *
 * The doc is a stream of block nodes. Two kinds of block exist:
 *
 *   - `paragraph` — free-form prose the user types. Carries no structure
 *     until the in-browser classifier decides what it is.
 *   - `field` — a classified block whose text is bound to a JSONPath
 *     (`path`) in the validated payload. Displayed with a chip showing
 *     the detected `label` and `confidence`.
 *
 * `section` is retained as an optional grouping block (reserved for
 * future use — e.g. grouping sibling `field`s under a heading). It is
 * not created by the default flow; the serializer walks fields wherever
 * they live in the tree.
 */

import { Schema } from "prosemirror-model";

export const editorSchema = new Schema({
  nodes: {
    doc: { content: "block+" },

    paragraph: {
      group: "block",
      content: "text*",
      toDOM: () => ["p", { class: "glyph-paragraph" }, 0],
      parseDOM: [{ tag: "p.glyph-paragraph" }, { tag: "p" }],
    },

    field: {
      group: "block",
      content: "text*",
      attrs: {
        path: { default: "" },
        label: { default: "" },
        confidence: { default: 0 },
      },
      toDOM: (node) => [
        "div",
        {
          class: "glyph-field",
          "data-path": String(node.attrs.path ?? ""),
          "data-label": String(node.attrs.label ?? ""),
          "data-confidence": String(node.attrs.confidence ?? 0),
        },
        0,
      ],
      parseDOM: [
        {
          tag: "div.glyph-field",
          getAttrs: (dom: HTMLElement) => ({
            path: dom.getAttribute("data-path") ?? "",
            label: dom.getAttribute("data-label") ?? "",
            confidence: Number(dom.getAttribute("data-confidence") ?? 0),
          }),
        },
      ],
    },

    section: {
      group: "block",
      content: "field+",
      attrs: { heading: { default: "" } },
      toDOM: (node) => [
        "section",
        { "data-heading": String(node.attrs.heading ?? "") },
        0,
      ],
      parseDOM: [
        {
          tag: "section",
          getAttrs: (dom: HTMLElement) => ({
            heading: dom.getAttribute("data-heading") ?? "",
          }),
        },
      ],
    },

    text: { group: "inline" },
  },
  marks: {},
});

export type EditorSchema = typeof editorSchema;
