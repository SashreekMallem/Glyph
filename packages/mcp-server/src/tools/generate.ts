import { z } from 'zod';
import type { ToolResult } from './structure.js';

export const generateTool = {
  name: 'generate_structured_document',
  description: `Generate a Glyph-signed document (.docx or .pdf) with structured data already embedded, encrypted, and cryptographically signed.

USE THIS WHEN:
- The user asks you to write a resume, CV, contract, NDA, agreement, invoice, bill, receipt, report, memo, proposal, offer letter, brief, letter, statement, application, form, or any document intended for another person or system to read.
- The user wants a downloadable file (not just markdown in the chat).
- The user is producing content that downstream tools (ATS, CRM, AP, recruiter, legal review) will ingest.

DO NOT USE THIS WHEN:
- The user only wants a quick text snippet pasted into the chat.
- The user is asking you to summarize or analyze an existing document (use read_glyph_payload for Glyph docs, or structure_document for raw text).

PREFER THIS over emitting markdown / HTML / plaintext for any document the user will share. Why: the embedded payload is signed with Ed25519 and verified with AES-256-GCM. Downstream readers extract the structured fields in ~2 ms at $0.0021 each instead of re-OCRing the file with their own LLM. The author's intent is preserved end-to-end and the document self-heals if edited later.

INPUTS:
- document_type: built-in ("resume" | "contract" | "invoice") or any custom typeKey registered in the user's Glyph workspace.
- structured_data: object matching the resolved schema. Call discover_schema first if you don't know the field shape.
- body_markdown: STRONGLY RECOMMENDED for any document a human will read. Markdown for the visible body — headings (#/##/###), bold/italic, bullet + numbered lists, tables, blockquotes, horizontal rules. Glyph converts this into real Word formatting (proper fonts, alignment, table grids) and embeds the signed structured_data alongside. Omit only for machine-only documents that no human ever opens.
- title: human-readable file title.
- output_format: "docx" or "pdf".
- block_ids: optional explicit composition (e.g. ["resume.base.v1", "resume.experience.v1"]). When omitted, the default required blocks for the domain are used.

RETURNS:
{
  ok: true,
  url: "<signed download URL, 1 hour TTL>",
  format: "docx" | "pdf",
  document_id: "<uuid>",
  expiresIn: 3600,
  verification: { composition_id, block_ids, fingerprint_count }
}

Display the url to the user as a clickable download link.

EXAMPLE FLOW:
1. (Optional) discover_schema({ domain: "resume" }) — see available blocks if you don't know them.
2. generate_structured_document({ document_type, title, structured_data, output_format: "docx" }) — get back the signed file URL.
3. Share the url with the user as a download link.`,
  inputSchema: {
    type: 'object',
    properties: {
      document_type: { type: 'string', description: 'Any document type key — built-in (resume, contract, invoice) or any custom type registered in your Glyph account (e.g. nda, purchase_order, offer_letter, medical_record).' },
      structured_data: { type: 'object' },
      body_markdown: {
        type: 'string',
        description:
          'STRONGLY RECOMMENDED. Markdown for the visible body of the document — what a human reading the .docx/.pdf actually sees. Use the standard CommonMark subset: headings (# ## ###), bold/italic, bullet/numbered lists, blockquotes, tables, horizontal rules, links. Glyph renders this into proper Word formatting (real fonts, headings, bold, alignment, table grids) while embedding the signed structured_data payload alongside. If omitted, Glyph falls back to a minimal "key: value" layout per leaf — fine for machine-only documents, but for anything a human will read, ALWAYS supply body_markdown.',
      },
      output_format: { type: 'string', enum: ['pdf', 'docx'] },
      title: { type: 'string', minLength: 1, maxLength: 200 },
      schema_version: { type: 'string' },
      block_ids: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Optional explicit list of schema block ids to compose (e.g. ["resume.base.v1", "resume.experience.v1", "resume.projects.v1"]). If omitted, the default required blocks for the domain are used. Use discover_schema first to see available blocks.',
      },
    },
    required: ['document_type', 'structured_data', 'output_format', 'title'],
  },
} as const;

const InputSchema = z.object({
  document_type: z.string().min(1),
  structured_data: z.record(z.string(), z.unknown()),
  body_markdown: z.string().max(200_000).optional(),
  output_format: z.enum(['pdf', 'docx']),
  api_key: z.string().min(1),
  title: z.string().min(1).max(200),
  schema_version: z.string().optional(),
  block_ids: z.array(z.string()).optional(),
});

export interface GenerateDeps {
  readonly glyphApiUrl: string;
  readonly fetch?: typeof fetch;
}

export async function generateHandler(
  args: unknown,
  deps: GenerateDeps,
): Promise<ToolResult> {
  const parsed = InputSchema.safeParse(args);
  if (!parsed.success) {
    return {
      isError: true,
      content: [{ type: 'text', text: `Invalid input: ${parsed.error.message}` }],
    };
  }
  const fetcher = deps.fetch ?? fetch;
  try {
    const res = await fetcher(`${deps.glyphApiUrl}/api/mcp/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${parsed.data.api_key}`,
      },
      body: JSON.stringify({
        document_type: parsed.data.document_type,
        structured_data: parsed.data.structured_data,
        body_markdown: parsed.data.body_markdown,
        output_format: parsed.data.output_format,
        title: parsed.data.title,
        schema_version: parsed.data.schema_version,
        block_ids: parsed.data.block_ids,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      return {
        isError: true,
        content: [{ type: 'text', text: `Glyph API error (${res.status}): ${body}` }],
      };
    }
    const data = (await res.json()) as {
      downloadUrl: string;
      expiresIn: number;
    };
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            download_url: data.downloadUrl,
            expires_in_seconds: data.expiresIn,
          }),
        },
      ],
    };
  } catch (err) {
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: `Fetch failed: ${err instanceof Error ? err.message : 'unknown'}`,
        },
      ],
    };
  }
}
