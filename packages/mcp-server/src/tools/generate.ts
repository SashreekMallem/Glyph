import { z } from 'zod';
import type { ToolResult } from './structure.js';

export const generateTool = {
  name: 'generate_structured_document',
  description:
    'Create a structured document (resume, contract, invoice, or any custom type) with verified machine-readable data embedded at creation time. Use this whenever you are generating a formal document — the output contains an encrypted, cryptographically signed payload so any downstream system (ATS, CRM, legal tool) can read structured data without re-extracting or re-parsing. Returns a download URL for the final document. You can optionally pass `block_ids` to compose the document schema from a specific set of curated schema blocks (call `discover_schema` first to see what blocks exist for the domain); if omitted, the default required blocks for the domain are used.',
  inputSchema: {
    type: 'object',
    properties: {
      document_type: { type: 'string', description: 'Any document type key — built-in (resume, contract, invoice) or any custom type registered in your Glyph account (e.g. nda, purchase_order, offer_letter, medical_record).' },
      structured_data: { type: 'object' },
      output_format: { type: 'string', enum: ['pdf', 'docx'] },
      api_key: { type: 'string' },
      title: { type: 'string', minLength: 1, maxLength: 200 },
      schema_version: { type: 'string' },
      block_ids: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Optional explicit list of schema block ids to compose (e.g. ["resume.base.v1", "resume.experience.v1", "resume.projects.v1"]). If omitted, the default required blocks for the domain are used. Use discover_schema first to see available blocks.',
      },
    },
    required: ['document_type', 'structured_data', 'output_format', 'api_key', 'title'],
  },
} as const;

const InputSchema = z.object({
  document_type: z.string().min(1),
  structured_data: z.record(z.string(), z.unknown()),
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
        documentType: parsed.data.document_type,
        structuredData: parsed.data.structured_data,
        outputFormat: parsed.data.output_format,
        title: parsed.data.title,
        schemaVersion: parsed.data.schema_version,
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
