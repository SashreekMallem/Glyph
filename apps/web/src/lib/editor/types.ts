/**
 * Editor descriptor types.
 *
 * Standalone (no ProseMirror/Tiptap imports) so consumers can type-check
 * field metadata without pulling editor weight into their bundles.
 */

export interface FieldDescriptor {
  readonly path: string;
  readonly label: string;
  readonly section: string;
  readonly type?: "string" | "number" | "boolean" | "date";
  readonly placeholder?: string;
}

export type FieldType = NonNullable<FieldDescriptor["type"]>;
export type TypeMap = Record<string, FieldType>;
