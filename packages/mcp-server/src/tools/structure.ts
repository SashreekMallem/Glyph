import { z } from 'zod';
import { getSchema, isBuiltInDocumentType } from '@glyph/schema-library';
import { extractHeuristic } from '../extractor.js';

export const structureTool = {
  name: 'structure_document',
  description:
    'Convert raw document text into validated structured JSON. Works with any document type — built-in (resume, contract, invoice) or custom types registered in your Glyph account (nda, offer_letter, purchase_order, etc.). Pass an api_key to use LLM-grade extraction; without it a deterministic heuristic is used for built-in types.',
  inputSchema: {
    type: 'object',
    properties: {
      document_type: {
        type: 'string',
        description: 'Any document type key — built-in (resume, contract, invoice) or custom (e.g. nda, offer_letter, purchase_order, medical_record).',
      },
      raw_text: { type: 'string', minLength: 10 },
      context: { type: 'string' },
      api_key: { type: 'string' },
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

  // LLM-grade path (built-in or custom): delegate to /api/v1/extract
  // which resolves the schema server-side (supports tenant custom types).
  if (api_key && deps.glyphApiUrl) {
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

  // Heuristic fallback — only works for built-in types offline.
  if (!isBuiltInDocumentType(document_type)) {
    return {
      isError: true,
      content: [{
        type: 'text',
        text: `Custom document type "${document_type}" requires an api_key for server-side schema resolution. Pass your Glyph API key.`,
      }],
    };
  }

  const { extracted } = extractHeuristic(document_type, raw_text);
  const schema = getSchema(document_type);
  const result = schema.safeParse(extracted);
  if (!result.success) {
    return {
      isError: true,
      content: [{
        type: 'text',
        text: JSON.stringify({
          valid: false,
          errors: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        }),
      }],
    };
  }
  return { content: [{ type: 'text', text: JSON.stringify(result.data) }] };
}
