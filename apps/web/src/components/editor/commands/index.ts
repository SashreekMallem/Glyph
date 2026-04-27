/**
 * ProseMirror keymap commands for Glyph's editor.
 *
 * We reuse the standard baseKeymap for cross-platform basics and layer
 * on history (undo/redo) plus a custom Enter handler that prevents
 * creating new section/field nodes the user didn't mean — Enter inside
 * a field just exits to the next field.
 */

import { baseKeymap } from "prosemirror-commands";
import { history, redo, undo } from "prosemirror-history";
import { keymap } from "prosemirror-keymap";
import type { Plugin } from "prosemirror-state";
import type { Command } from "prosemirror-state";

const moveToNextField: Command = (state, dispatch) => {
  const { doc, selection } = state;
  // Find the next field after the current cursor position.
  const pos = selection.to;
  let found: number | null = null;
  doc.descendants((node, p) => {
    if (found !== null) return false;
    if (node.type.name !== "field") return true;
    // The first position inside a field is p+1.
    const inside = p + 1;
    if (inside > pos) found = inside;
    return false;
  });
  if (found === null) return false;
  if (dispatch) {
    const Selection = (state.selection.constructor as unknown) as {
      near: (resolvedPos: ReturnType<typeof doc.resolve>) => unknown;
    };
    const tr = state.tr.setSelection(Selection.near(doc.resolve(found)) as never);
    dispatch(tr);
  }
  return true;
};

export function editorCommands(): Plugin[] {
  return [
    history(),
    keymap({
      "Mod-z": undo,
      "Mod-y": redo,
      "Mod-Shift-z": redo,
      Enter: moveToNextField,
      Tab: moveToNextField,
    }),
    keymap(baseKeymap),
  ];
}
