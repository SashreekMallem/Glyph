import "../setup-keys";

import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { encryptPayload, signPayload } from "@glyph/crypto";

import {
  generatePdf,
  extractXmp,
  buildGlyphXmpPacket,
  parseGlyphXmpPacket,
  escapeXmlAttr,
} from "@/lib/pdf";
import type { Contract } from "@glyph/schema-library";

const contractFixture: Contract = {
  document_type: "contract",
  schema_version: "1.0",
  parties: [
    { name: "Acme <Corp> & Co.", role: "client" },
    { name: "Beta \"Ltd\"", role: "vendor" },
  ],
  effective_date: "2025-01-01",
  obligations: [
    { party: "Acme <Corp> & Co.", description: "Deliver widgets > 100" },
  ],
  governing_law: "Delaware",
  confidentiality: true,
};

describe("Glyph PDF XMP roundtrip", () => {
  it("XML escape handles all five predefined entities", () => {
    const raw = `a&b<c>d"e'f`;
    const esc = escapeXmlAttr(raw);
    expect(esc).toBe("a&amp;b&lt;c&gt;d&quot;e&apos;f");
  });

  it("buildGlyphXmpPacket + parseGlyphXmpPacket round-trip cleanly", () => {
    const packet = buildGlyphXmpPacket({
      documentType: "contract",
      schemaVersion: "1.0",
      encrypted: "YWJjZA==",
      iv: "MTIzNA==",
      tag: "dGFn",
      signature: "c2ln",
      timestamp: "2026-04-23T00:00:00.000Z",
    });
    const parsed = parseGlyphXmpPacket(packet);
    expect(parsed).not.toBeNull();
    expect(parsed?.documentType).toBe("contract");
    expect(parsed?.encrypted).toBe("YWJjZA==");
    expect(parsed?.iv).toBe("MTIzNA==");
    expect(parsed?.tag).toBe("dGFn");
    expect(parsed?.signature).toBe("c2ln");
  });

  it("injects and extracts Glyph XMP from a generated PDF", async () => {
    const { encrypted, iv, tag } = await encryptPayload(contractFixture);
    const signature = await signPayload(encrypted);
    const timestamp = new Date().toISOString();

    const bytes = await generatePdf({
      document: contractFixture,
      xmp: {
        documentType: "contract",
        schemaVersion: "1.0",
        encrypted,
        iv,
        tag,
        signature,
        timestamp,
      },
    });

    expect(bytes.byteLength).toBeGreaterThan(500);

    const extracted = extractXmp(bytes);
    expect(extracted).not.toBeNull();
    expect(extracted?.documentType).toBe("contract");
    expect(extracted?.schemaVersion).toBe("1.0");
    expect(extracted?.encrypted).toBe(encrypted);
    expect(extracted?.iv).toBe(iv);
    expect(extracted?.tag).toBe(tag);
    expect(extracted?.signature).toBe(signature);
    expect(extracted?.timestamp).toBe(timestamp);
  });

  it("returns null for a non-Glyph PDF", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage();
    page.drawText("Hello world", { x: 50, y: 700, size: 12, font });
    const bytes = await doc.save();
    expect(extractXmp(bytes)).toBeNull();
  });

  it("parses when the packet contains tricky escaped characters", () => {
    const packet = buildGlyphXmpPacket({
      documentType: "contract",
      schemaVersion: "1.0",
      // Base64 never contains < & > " ', so synthesise a signature that
      // exercises escaping via the schema version free-form field only.
      encrypted: "YWJjZA==",
      iv: "MTIzNA==",
      tag: "dGFn",
      signature: "c2ln",
      timestamp: `2026-04-23T00:00:00.000Z<&>"'`,
    });
    const parsed = parseGlyphXmpPacket(packet);
    expect(parsed?.timestamp).toBe(`2026-04-23T00:00:00.000Z<&>"'`);
  });
});
