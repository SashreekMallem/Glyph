import { describe, expect, it } from "vitest";
import { docToJson, jsonToDoc, type FieldDescriptor } from "./serialize";
import { editorSchema } from "@/components/editor/schema";

const descriptors: FieldDescriptor[] = [
  { path: "parties.0.name", label: "Party A Name", section: "Parties" },
  { path: "parties.0.role", label: "Party A Role", section: "Parties" },
  { path: "parties.1.name", label: "Party B Name", section: "Parties" },
  { path: "effective_date", label: "Effective Date", section: "Dates", type: "string" },
  { path: "termination_notice_days", label: "Termination Notice", section: "Terms", type: "number" },
  { path: "confidentiality", label: "Confidentiality", section: "Terms", type: "boolean" },
];

describe("serialize", () => {
  it("round-trips structured data", () => {
    const values = {
      parties: [
        { name: "A Co", role: "client" },
        { name: "B Co", role: "vendor" },
      ],
      effective_date: "2025-01-01",
      termination_notice_days: 30,
      confidentiality: true,
    };
    const doc = jsonToDoc(descriptors, values);
    const json = docToJson(doc, {
      "termination_notice_days": "number",
      "confidentiality": "boolean",
    });
    expect(json).toMatchObject({
      parties: [
        { name: "A Co", role: "client" },
        { name: "B Co" },
      ],
      effective_date: "2025-01-01",
      termination_notice_days: 30,
      confidentiality: true,
    });
  });

  it("coerces number and boolean fields", () => {
    const doc = jsonToDoc(descriptors, {
      termination_notice_days: "45",
      confidentiality: "yes",
    });
    const json = docToJson(doc, {
      termination_notice_days: "number",
      confidentiality: "boolean",
    });
    expect(json.termination_notice_days).toBe(45);
    expect(json.confidentiality).toBe(true);
  });

  it("empty field becomes empty string", () => {
    const doc = jsonToDoc(descriptors, {});
    const json = docToJson(doc);
    expect(json.effective_date).toBe("");
  });

  it("auto-scales `$` placeholder indices on repeated field kinds", () => {
    // Build a doc by hand: two `experience.$.company` / `.title` pairs should
    // become experience[0] and experience[1].
    const field = (path: string, text: string) =>
      editorSchema.nodes.field.create({ path, label: path }, editorSchema.text(text));
    const doc = editorSchema.nodes.doc.create(null, [
      editorSchema.nodes.section.create({ heading: "Experience" }, [
        field("experience.$.company", "Acme"),
        field("experience.$.title", "Engineer"),
        field("experience.$.company", "Globex"),
        field("experience.$.title", "Manager"),
      ]),
    ]);
    const json = docToJson(doc);
    expect(json).toMatchObject({
      experience: [
        { company: "Acme", title: "Engineer" },
        { company: "Globex", title: "Manager" },
      ],
    });
  });
});
