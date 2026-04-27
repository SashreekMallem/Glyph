import "../setup-keys";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import {
  encryptPayload,
  signPayload,
  generateApiKey,
} from "@glyph/crypto";

import { generatePdf } from "@/lib/pdf";
import type { Contract } from "@glyph/schema-library";

type KeyRow = {
  id: string;
  userId: string;
  keyHash: string;
  keyPrefix: string;
  isActive: boolean;
  name: string;
};

const state: {
  keys: KeyRow[];
  limitSuccess: boolean;
  usageInserts: unknown[];
  keyUpdates: unknown[];
} = {
  keys: [],
  limitSuccess: true,
  usageInserts: [],
  keyUpdates: [],
};

vi.mock("@/db", () => {
  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async (_n: number) =>
            state.keys.length > 0 ? [state.keys[0]] : [],
        }),
      }),
    }),
    insert: () => ({
      values: async (v: unknown) => {
        state.usageInserts.push(v);
      },
    }),
    update: () => ({
      set: (v: unknown) => ({
        where: async () => {
          state.keyUpdates.push(v);
        },
      }),
    }),
  };
  return { db };
});

vi.mock("@/lib/extract-ratelimit", () => ({
  getExtractLimiter: () => ({
    limit: async () => ({ success: state.limitSuccess }),
  }),
}));

import { POST } from "@/app/api/v1/extract/route";
import type { NextRequest } from "next/server";

const contractFixture: Contract = {
  document_type: "contract",
  schema_version: "1.0",
  parties: [
    { name: "Acme Inc", role: "client" },
    { name: "Beta LLC", role: "vendor" },
  ],
  effective_date: "2025-01-01",
  obligations: [{ party: "Acme Inc", description: "Pay invoice on time" }],
  governing_law: "Delaware",
  confidentiality: false,
};

async function seedKey(): Promise<string> {
  const { raw, hash, prefix } = generateApiKey();
  state.keys = [
    {
      id: "11111111-1111-1111-1111-111111111111",
      userId: "22222222-2222-2222-2222-222222222222",
      keyHash: hash,
      keyPrefix: prefix,
      isActive: true,
      name: "test",
    },
  ];
  return raw;
}

async function buildGlyphPdf(): Promise<Uint8Array> {
  const { encrypted, iv, tag } = await encryptPayload(contractFixture);
  const signature = await signPayload(encrypted);
  return generatePdf({
    document: contractFixture,
    xmp: {
      documentType: "contract",
      schemaVersion: "1.0",
      encrypted,
      iv,
      tag,
      signature,
      timestamp: new Date().toISOString(),
    },
  });
}

async function buildBlankPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage();
  page.drawText("not a glyph document", { x: 50, y: 700, size: 12, font });
  return doc.save();
}

function multipartReq(
  bytes: Uint8Array,
  filename: string,
  auth: string,
): NextRequest {
  const form = new FormData();
  const blob = new Blob([bytes], { type: "application/pdf" });
  form.append("file", blob, filename);
  return new Request("http://localhost/api/v1/extract", {
    method: "POST",
    headers: { authorization: `Bearer ${auth}` },
    body: form,
  }) as unknown as NextRequest;
}

beforeEach(() => {
  state.keys = [];
  state.limitSuccess = true;
  state.usageInserts = [];
  state.keyUpdates = [];
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/v1/extract multipart PDF", () => {
  it("200 for a valid Glyph PDF and returns decoded contract", async () => {
    const raw = await seedKey();
    const pdf = await buildGlyphPdf();
    const res = await POST(multipartReq(pdf, "contract.pdf", raw));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      document_type: string;
      signature_valid: boolean;
      data: { governing_law: string };
    };
    expect(body.document_type).toBe("contract");
    expect(body.signature_valid).toBe(true);
    expect(body.data.governing_law).toBe("Delaware");
  });

  it("400 no_glyph_metadata for a non-Glyph PDF", async () => {
    const raw = await seedKey();
    const pdf = await buildBlankPdf();
    const res = await POST(multipartReq(pdf, "blank.pdf", raw));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("no_glyph_metadata");
  });

  it("415 for DOCX uploads", async () => {
    const raw = await seedKey();
    const form = new FormData();
    form.append(
      "file",
      new Blob([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      }),
      "doc.docx",
    );
    const req = new Request("http://localhost/api/v1/extract", {
      method: "POST",
      headers: { authorization: `Bearer ${raw}` },
      body: form,
    }) as unknown as NextRequest;
    const res = await POST(req);
    expect(res.status).toBe(415);
  });
});
