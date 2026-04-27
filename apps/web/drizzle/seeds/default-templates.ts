/**
 * Default field descriptors seeded into `document_templates` for the
 * three built-in document types. These mirror what the editor will
 * render by default; users can edit or clone them via the templates UI.
 *
 * Shape matches `FieldDescriptor` in `apps/web/src/lib/editor/serialize.ts`:
 *   { path: string, label: string, section: string, type?: "string"|"number"|"boolean"|"date", placeholder?: string }
 */

export interface SeedDescriptor {
  readonly path: string;
  readonly label: string;
  readonly section: string;
  readonly type?: "string" | "number" | "boolean" | "date";
  readonly placeholder?: string;
}

export const CONTRACT_TEMPLATE: readonly SeedDescriptor[] = [
  { section: "Meta", path: "document_type", label: "Type" },
  { section: "Meta", path: "schema_version", label: "Schema Version" },
  { section: "Parties", path: "parties.0.name", label: "Party A Name" },
  { section: "Parties", path: "parties.0.role", label: "Party A Role", placeholder: "client" },
  { section: "Parties", path: "parties.1.name", label: "Party B Name" },
  { section: "Parties", path: "parties.1.role", label: "Party B Role", placeholder: "vendor" },
  { section: "Dates", path: "effective_date", label: "Effective Date", placeholder: "YYYY-MM-DD" },
  { section: "Dates", path: "expiry_date", label: "Expiry Date", placeholder: "YYYY-MM-DD" },
  { section: "Terms", path: "governing_law", label: "Governing Law", placeholder: "California" },
  { section: "Terms", path: "termination_notice_days", label: "Termination Notice (days)", type: "number" },
  { section: "Terms", path: "confidentiality", label: "Confidentiality", type: "boolean" },
];

export const RESUME_TEMPLATE: readonly SeedDescriptor[] = [
  { section: "Meta", path: "document_type", label: "Type" },
  { section: "Meta", path: "schema_version", label: "Schema Version" },
  { section: "Identity", path: "full_name", label: "Full Name" },
  { section: "Identity", path: "contact.email", label: "Email" },
  { section: "Identity", path: "contact.phone", label: "Phone" },
  { section: "Summary", path: "summary", label: "Summary" },
];

export const INVOICE_TEMPLATE: readonly SeedDescriptor[] = [
  { section: "Meta", path: "document_type", label: "Type" },
  { section: "Meta", path: "schema_version", label: "Schema Version" },
  { section: "Header", path: "invoice_number", label: "Invoice #" },
  { section: "Header", path: "issue_date", label: "Issue Date", placeholder: "YYYY-MM-DD" },
  { section: "Header", path: "due_date", label: "Due Date", placeholder: "YYYY-MM-DD" },
  { section: "Header", path: "currency", label: "Currency", placeholder: "USD" },
  { section: "Totals", path: "total", label: "Total", type: "number" },
];
