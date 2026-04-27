/**
 * Debounced auto-save plugin. Fires a callback with the latest doc
 * JSON a fixed interval after the last edit.
 */

import { Plugin, PluginKey } from "prosemirror-state";
import type { Node } from "prosemirror-model";

export const autoSaveKey = new PluginKey("glyph-auto-save");

export function autoSavePlugin(
  onSave: (doc: Node) => void,
  delayMs = 1200,
): Plugin {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return new Plugin({
    key: autoSaveKey,
    view() {
      return {
        update(view, prevState) {
          if (view.state.doc.eq(prevState.doc)) return;
          if (timer !== null) clearTimeout(timer);
          timer = setTimeout(() => {
            onSave(view.state.doc);
            timer = null;
          }, delayMs);
        },
        destroy() {
          if (timer !== null) clearTimeout(timer);
        },
      };
    },
  });
}
