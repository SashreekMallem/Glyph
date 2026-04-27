import "../setup-keys";

import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";

import {
  renderContract,
  renderResume,
  renderInvoice,
} from "@/lib/pdf";
import type {
  Contract,
  Invoice,
  Resume,
} from "@glyph/schema-library";

const contractFixture: Contract = {
  document_type: "contract",
  schema_version: "1.0",
  parties: [
    { name: "Acme Inc", role: "client" },
    { name: "Beta LLC", role: "vendor" },
  ],
  effective_date: "2025-01-01",
  expiry_date: "2026-01-01",
  payment_terms: {
    amount: 10000,
    currency: "USD",
    schedule: "monthly",
    due_days: 30,
  },
  obligations: [
    { party: "Acme Inc", description: "Pay on time" },
    { party: "Beta LLC", description: "Deliver the widgets", deadline: "2025-06-01" },
  ],
  governing_law: "Delaware",
  confidentiality: true,
  termination_notice_days: 30,
};

const resumeFixture: Resume = {
  document_type: "resume",
  schema_version: "1.0",
  personal: {
    full_name: "Jane Doe",
    email: "jane@example.com",
    phone: "555-0100",
    location: "San Francisco, CA",
  },
  summary: "Senior engineer with 10+ years of experience.",
  experience: [
    {
      company: "TechCo",
      title: "Senior Engineer",
      start_date: "2020-01-01",
      end_date: "2024-12-31",
      description: "Led platform team.",
      achievements: ["Shipped v2", "Grew team from 3 to 12"],
    },
  ],
  education: [
    { institution: "MIT", degree: "BS", field: "CS", graduation_year: 2014 },
  ],
  skills: [{ category: "Languages", items: ["TypeScript", "Go", "Rust"] }],
};

const invoiceFixture: Invoice = {
  document_type: "invoice",
  schema_version: "1.0",
  invoice_number: "INV-0001",
  issue_date: "2025-03-01",
  due_date: "2025-04-01",
  vendor: { name: "Acme Inc", email: "billing@acme.com" },
  bill_to: { name: "Beta LLC", email: "ap@beta.com" },
  line_items: [
    { description: "Consulting", quantity: 10, unit_price: 250, total: 2500 },
  ],
  subtotal: 2500,
  tax_rate: 0.1,
  tax_amount: 250,
  total: 2750,
  currency: "USD",
};

describe("Glyph PDF renderers", () => {
  it("renderContract produces a loadable PDF with at least one page", async () => {
    const pdfDoc = await renderContract(contractFixture);
    const bytes = await pdfDoc.save();
    expect(bytes.byteLength).toBeGreaterThan(500);
    const reloaded = await PDFDocument.load(bytes);
    expect(reloaded.getPageCount()).toBeGreaterThanOrEqual(1);
  });

  it("renderResume produces a loadable PDF", async () => {
    const pdfDoc = await renderResume(resumeFixture);
    const bytes = await pdfDoc.save();
    const reloaded = await PDFDocument.load(bytes);
    expect(reloaded.getPageCount()).toBeGreaterThanOrEqual(1);
  });

  it("renderInvoice produces a loadable PDF", async () => {
    const pdfDoc = await renderInvoice(invoiceFixture);
    const bytes = await pdfDoc.save();
    const reloaded = await PDFDocument.load(bytes);
    expect(reloaded.getPageCount()).toBeGreaterThanOrEqual(1);
  });

  it("contract PDF identifies Glyph as the producer and loads cleanly", async () => {
    const pdfDoc = await renderContract(contractFixture);
    const bytes = await pdfDoc.save();
    const reloaded = await PDFDocument.load(bytes);
    // pdf-lib flate-compresses content streams, so we can't search the
    // raw bytes for rendered text. Verify document-level metadata and
    // that at least one page was emitted.
    expect(reloaded.getCreator()).toContain("Glyph");
    expect(reloaded.getPageCount()).toBeGreaterThanOrEqual(1);
  });
});
