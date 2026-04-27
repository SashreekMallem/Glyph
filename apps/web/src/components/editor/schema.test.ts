import { describe, expect, it } from "vitest";
import { editorSchema } from "./schema";

describe("editorSchema", () => {
  it("defines doc/section/field/text nodes", () => {
    expect(editorSchema.nodes.doc).toBeDefined();
    expect(editorSchema.nodes.section).toBeDefined();
    expect(editorSchema.nodes.field).toBeDefined();
    expect(editorSchema.nodes.text).toBeDefined();
  });

  it("builds a minimal valid document", () => {
    const field = editorSchema.nodes.field.create(
      { path: "a.b", label: "B" },
      editorSchema.text("hello"),
    );
    const section = editorSchema.nodes.section.create({ heading: "S" }, field);
    const doc = editorSchema.nodes.doc.create(null, section);
    expect(doc.childCount).toBe(1);
    expect(doc.firstChild?.firstChild?.attrs.path).toBe("a.b");
  });

  it("rejects a doc without sections", () => {
    expect(() => editorSchema.nodes.doc.createChecked()).toThrow();
  });
});
