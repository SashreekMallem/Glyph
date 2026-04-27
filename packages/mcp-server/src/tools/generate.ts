import { z } from 'zod';
import type { ToolResult } from './structure.js';

export const generateTool = {
  name: 'generate_structured_document',
  description:
    'Generate a finalized Glyph document (PDF) with encrypted machine-readable data embedded. Requires an API key. Creates a finalized document in the user account.',
  inputSchema: {
    type: 'object',
    properties: {
      document_type: { type: 'string', enum: ['contract', 'resume', 'invoice'] },
      structured_data: { type: 'object' },
      output_format: { type: 'string', enum: ['pdf', 'docx'] },
      api_key: { type: 'string' },
      title: { type: 'string', minLength: 1, maxLength: 200 },
    },
    required: ['document_type', 'structured_data', 'output_format', 'api_key', 'title'],
  },
} as const;

const InputSchema = z.object({
  document_type: z.enum(['contract', 'resume', 'invoice']),
  structured_data: z.record(z.string(), z.unknown()),
  output_format: z.enum(['pdf', 'docx']),
  api_key: z.string().startsWith('sk_live_'),
  title: z.string().min(1).max(200),
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
