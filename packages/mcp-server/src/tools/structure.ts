import { z } from 'zod';

export const structureTool = {
  name: 'structure_document',
  description: `Extract structured JSON from raw document text someone else wrote. Runs Gemini-grade extraction against the schema for the given document type.

USE THIS WHEN:
- The user pasted raw text (plain text, OCR output, scraped HTML, etc.) and wants it turned into structured fields.
- You need to analyze a document the user did NOT generate with you.

DO NOT USE THIS WHEN:
- YOU are writing the document. You already know what you wrote — call generate_structured_document directly with the structured payload you composed. There is no reason to round-trip your own prose through an extraction pass.
- The document is a Glyph-stamped .docx/.pdf. Use read_glyph_payload instead — it decrypts the embedded payload in ~2 ms with no LLM call.

WHY: This tool exists for human-authored or third-party raw text. Re-extracting your own output wastes tokens, latency, and cost. The whole point of Glyph is that authoring and structuring happen together — when YOU are the author, skip the round-trip.

INPUTS:
- document_type: e.g. "resume", "contract", "invoice", or any custom typeKey.
- raw_text: the plain text to structure (≥ 10 chars).
- context: optional hint string passed to the extractor.

RETURNS:
{ extracted: { ...structured JSON matching the resolved schema... } }`,
  inputSchema: {
    type: 'object',
    properties: {
      document_type: {
        type: 'string',
        description: 'Any document type key registered in your Glyph account (e.g. resume, contract, invoice, nda, offer_letter, purchase_order, medical_record).',
      },
      raw_text: { type: 'string', minLength: 10 },
      context: { type: 'string' },
    },
    required: ['document_type', 'raw_text'],
  },
} as const;

const InputSchema = z.object({
  document_type: z.string().min(1),
  raw_text: z.string().min(10),
  context: z.string().optional(),
  api_key: z.string().optional(),
});

export interface StructureDeps {
  readonly glyphApiUrl?: string;
  readonly fetch?: typeof fetch;
}

export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export async function structureHandler(
  args: unknown,
  deps: StructureDeps = {},
): Promise<ToolResult> {
  const parsed = InputSchema.safeParse(args);
  if (!parsed.success) {
    return {
      isError: true,
      content: [{ type: 'text', text: `Invalid input: ${parsed.error.message}` }],
    };
  }
  const { document_type, raw_text, api_key } = parsed.data;

  // All document types — including the legacy "contract"/"resume"/"invoice"
  // keys — now live in the document_types DB table, so we always delegate
  // to /api/v1/extract for tenant-aware schema resolution.
  if (!api_key || !deps.glyphApiUrl) {
    return {
      isError: true,
      content: [{
        type: 'text',
        text: `Document type "${document_type}" requires an api_key for server-side schema resolution. Pass your Glyph API key.`,
      }],
    };
  }

  const fetcher = deps.fetch ?? fetch;
  try {
    const res = await fetcher(`${deps.glyphApiUrl}/api/v1/extract`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${api_key}`,
      },
      body: JSON.stringify({ raw_text, document_type }),
    });
    if (!res.ok) {
      const body = await res.text();
      return {
        isError: true,
        content: [{ type: 'text', text: `Glyph API error (${res.status}): ${body}` }],
      };
    }
    const json = (await res.json()) as { data: unknown };
    return { content: [{ type: 'text', text: JSON.stringify(json.data) }] };
  } catch (err) {
    return {
      isError: true,
      content: [{ type: 'text', text: `Fetch failed: ${err instanceof Error ? err.message : 'unknown'}` }],
    };
  }
}
