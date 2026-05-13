import { z } from 'zod';
import type { ToolResult } from './structure.js';

export const discoverSchemaTool = {
  name: 'discover_schema',
  description: `List the schema blocks available for a document domain. Each block is a small reusable JSON Schema fragment (e.g. "resume.experience.v1") that contributes properties to the final composition.

USE THIS WHEN:
- You are about to call generate_structured_document and you don't already know the exact field shape for the document type.
- The user wants a non-standard composition (e.g. resume WITH projects + publications but WITHOUT skills).

DO NOT USE THIS WHEN:
- You already know the schema (e.g. you just called it earlier in this conversation).
- The user just wants the default — generate_structured_document with no block_ids picks the required defaults automatically.

WHY: Calling discover_schema first means you fill the structured_data correctly on the first generate call. No retries, no validation rejections, no guesses.

INPUTS:
- domain: e.g. "resume", "contract", "invoice", or any custom domain key.
- api_key: required.

RETURNS:
{
  blocks: [
    { id: "resume.base.v1", required: true, fields: ["full_name", "email", "summary"] },
    { id: "resume.experience.v1", required: true, fields: [...] },
    { id: "resume.projects.v1", required: false, fields: [...] },
    ...
  ]
}

If the returned list is empty for a domain, consider calling propose_schema_block to register a new block for that domain instead of inventing an ad-hoc shape.`,
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
