/**
 * Default field descriptors per document type.
 *
 * These shape the initial ProseMirror document when creating a new
 * document. They are intentionally minimal — the user can free-type
 * additional sections; the serializer only serializes fields that have
 * a `path`.
 */

import type { FieldDescriptor } from "@/lib/editor/types";

export const CONTRACT_DESCRIPTORS: FieldDescriptor[] = [
  { section: "Meta", path: "document_type", label: "Type" },
  { section: "Meta", path: "schema_version", label: "Schema Version" },
  { section: "Parties", path: "parties.0.name", label: "Party A Name" },
  { section: "Parties", path: "parties.0.role", label: "Party A Role" },
  { section: "Parties", path: "parties.1.name", label: "Party B Name" },
  { section: "Parties", path: "parties.1.role", label: "Party B Role" },
  { section: "Dates", path: "effective_date", label: "Effective Date" },
  { section: "Dates", path: "expiry_date", label: "Expiry Date" },
  { section: "Terms", path: "governing_law", label: "Governing Law" },
  {
    section: "Terms",
    path: "termination_notice_days",
    label: "Termination Notice (days)",
    type: "number",
  },
  {
    section: "Terms",
    path: "confidentiality",
    label: "Confidentiality",
    type: "boolean",
  },
];

export const RESUME_DESCRIPTORS: FieldDescriptor[] = [
  { section: "Meta", path: "document_type", label: "Type" },
  { section: "Meta", path: "schema_version", label: "Schema Version" },
  // Personal — flat object on ResumeSchema.
  { section: "Personal", path: "personal.full_name", label: "person name" },
  { section: "Personal", path: "personal.email", label: "email address" },
  { section: "Personal", path: "personal.phone", label: "phone number" },
  { section: "Personal", path: "personal.linkedin", label: "linkedin profile" },
  { section: "Personal", path: "personal.location", label: "location" },
  { section: "Personal", path: "personal.website", label: "website" },
  { section: "Summary", path: "summary", label: "professional summary" },
  // Arrays use `$` as a placeholder index; docToJson auto-scales to 0,1,2…
  // based on document order, opening a new entry when a field kind repeats.
  { section: "Experience", path: "experience.$.company", label: "company name" },
  { section: "Experience", path: "experience.$.title", label: "job title" },
  { section: "Experience", path: "experience.$.start_date", label: "start date" },
  { section: "Experience", path: "experience.$.end_date", label: "end date" },
  { section: "Experience", path: "experience.$.location", label: "work location" },
  { section: "Experience", path: "experience.$.description", label: "job description" },
  { section: "Education", path: "education.$.institution", label: "school" },
  { section: "Education", path: "education.$.degree", label: "degree" },
  { section: "Education", path: "education.$.field", label: "field of study" },
  {
    section: "Education",
    path: "education.$.graduation_year",
    label: "graduation year",
    type: "number",
  },
  { section: "Skills", path: "skills.$.category", label: "skill category" },
  { section: "Skills", path: "skills.$.items", label: "skill" },
  { section: "Certifications", path: "certifications.$.name", label: "certification name" },
  { section: "Certifications", path: "certifications.$.issuer", label: "certification issuer" },
];

export const INVOICE_DESCRIPTORS: FieldDescriptor[] = [
  { section: "Meta", path: "document_type", label: "Type" },
  { section: "Meta", path: "schema_version", label: "Schema Version" },
  { section: "Header", path: "invoice_number", label: "Invoice #" },
  { section: "Header", path: "issue_date", label: "Issue Date" },
  { section: "Header", path: "due_date", label: "Due Date" },
  { section: "Header", path: "currency", label: "Currency" },
  {
    section: "Totals",
    path: "total",
    label: "Total",
    type: "number",
  },
];

export type DocType = "contract" | "resume" | "invoice";

export function descriptorsFor(type: DocType): FieldDescriptor[] {
  switch (type) {
    case "contract":
      return CONTRACT_DESCRIPTORS;
    case "resume":
      return RESUME_DESCRIPTORS;
    case "invoice":
      return INVOICE_DESCRIPTORS;
  }
}

export function typeMapFor(
  descriptors: readonly FieldDescriptor[],
): Record<string, FieldDescriptor["type"]> {
  const out: Record<string, FieldDescriptor["type"]> = {};
  for (const d of descriptors) if (d.type) out[d.path] = d.type;
  return out;
}

export function initialValuesFor(type: DocType): Record<string, unknown> {
  return {
    document_type: type,
    schema_version: "1.0",
  };
}
