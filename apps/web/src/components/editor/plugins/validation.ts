/**
 * Live validation plugin. After each doc change, serializes to JSON,
 * runs the schema, and reports {valid, errors} via the callback.
 *
 * The schema lookup uses @glyph/schema-library on the client; the
 * package is ESM-safe and has no DOM deps.
 */

import { Plugin, PluginKey } from "prosemirror-state";
import type { Node } from "prosemirror-model";
import { getSchema } from "@glyph/schema-library";

import {
  docToJson,
  type FieldDescriptor,
} from "@/lib/editor/serialize";
import { typeMapFor } from "@/components/editor/descriptors";

export const validationKey = new PluginKey("glyph-validation");

export type ValidationReport =
  | { readonly valid: true; readonly data: unknown }
  | { readonly valid: false; readonly drafting: true }
  | {
      readonly valid: false;
      readonly drafting?: false;
      readonly errors: ReadonlyArray<{ path: string; message: string }>;
    };

export function validationPlugin(
  documentType: "contract" | "resume" | "invoice",
  descriptors: readonly FieldDescriptor[],
  onReport: (report: ValidationReport) => void,
): Plugin {
  const typeMap = typeMapFor(descriptors);
  const schema = getSchema(documentType);

  let lastTick = 0;
  const countFields = (doc: Node): number => {
    let n = 0;
    doc.descendants((node) => {
      if (node.type.name === "field") {
        n++;
        return false;
      }
      return true;
    });
    return n;
  };

  const run = (doc: Node): void => {
    if (countFields(doc) === 0) {
      onReport({ valid: false, drafting: true });
      return;
    }
    const json = docToJson(doc, typeMap);
    const result = schema.safeParse(json);
    if (result.success) {
      onReport({ valid: true, data: result.data });
    } else {
      onReport({
        valid: false,
        drafting: false,
        errors: result.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      });
    }
  };

  return new Plugin({
    key: validationKey,
    view() {
      return {
        update(view, prevState) {
          if (view.state.doc.eq(prevState.doc)) return;
          const tick = ++lastTick;
          // Yield to the main thread — validation is cheap but we
          // never want to block input.
          queueMicrotask(() => {
            if (tick !== lastTick) return;
            run(view.state.doc);
          });
        },
      };
    },
  });
}
