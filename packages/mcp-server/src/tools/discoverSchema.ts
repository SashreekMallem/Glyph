import { z } from 'zod';
import type { ToolResult } from './structure.js';

export const discoverSchemaTool = {
  name: 'discover_schema',
  description:
    'Discover what schema blocks are available for a document domain. Returns the list of curated, reusable schema fragments — required blocks (must always be included) and optional blocks (e.g. projects, publications, certifications for resume). Use this BEFORE generate_structured_document to compose a schema that exactly matches the document you are creating. The block library is the foundation of Glyph adaptive schemas: blocks are reused across users, costs nothing extra to use, and consumers can always parse the result.',
  inputSchema: {
    type: 'object',
    properties: {
      domain: {
        type: 'string',
        description:
          'Document domain (resume, contract, invoice, or any custom domain registered in your account).',
      },
      api_key: { type: 'string' },
    },
    required: ['domain', 'api_key'],
  },
} as const;

const InputSchema = z.object({
  domain: z.string().min(1),
  api_key: z.string().min(1),
});

export interface DiscoverSchemaDeps {
  readonly glyphApiUrl: string;
  readonly fetch?: typeof fetch;
}

export async function discoverSchemaHandler(
  args: unknown,
  deps: DiscoverSchemaDeps,
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
    const url = `${deps.glyphApiUrl}/api/v1/blocks?domain=${encodeURIComponent(parsed.data.domain)}`;
    const res = await fetcher(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${parsed.data.api_key}`,
      },
    });
    if (!res.ok) {
      const body = await res.text();
      return {
        isError: true,
        content: [{ type: 'text', text: `Glyph API error (${res.status}): ${body}` }],
      };
    }
    const data = (await res.json()) as unknown;
    return {
      content: [{ type: 'text', text: JSON.stringify(data) }],
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
