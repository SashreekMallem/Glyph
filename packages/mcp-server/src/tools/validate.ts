import { z } from 'zod';
import { getSchema, isBuiltInDocumentType } from '@glyph/schema-library';
import type { ToolResult } from './structure.js';

export const validateTool = {
  name: 'validate_document',
  description:
    'Validate structured document JSON against its Glyph schema. Works with any document type — built-in (resume, contract, invoice) or custom types registered in your Glyph account. Returns valid:true or a list of field errors.',
  inputSchema: {
    type: 'object',
    properties: {
      document_type: {
        type: 'string',
        description: 'Any document type key — built-in (resume, contract, invoice) or any custom type registered in your Glyph account (e.g. nda, offer_letter, purchase_order).',
      },
      structured_data: { type: 'object' },
      api_key: {
        type: 'string',
        description: 'Required for custom document types to fetch their schema from your Glyph account.',
      },
      block_ids: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Optional explicit list of schema block ids to validate against (e.g. ["resume.base.v1", "resume.experience.v1"]). If omitted, the default required blocks for the domain are used. Use discover_schema first to see available blocks.',
      },
    },
    required: ['document_type', 'structured_data'],
  },
} as const;

const InputSchema = z.object({
  document_type: z.string().min(1),
  structured_data: z.record(z.string(), z.unknown()),
  api_key: z.string().optional(),
  block_ids: z.array(z.string()).optional(),
});

export interface ValidateDeps {
  readonly glyphApiUrl?: string;
  readonly fetch?: typeof fetch;
}

export async function validateHandler(
  args: unknown,
  deps: ValidateDeps = {},
): Promise<ToolResult> {
  const parsed = InputSchema.safeParse(args);
  if (!parsed.success) {
    return {
      isError: true,
      content: [{ type: 'text', text: `Invalid input: ${parsed.error.message}` }],
    };
  }
  const { document_type, structured_data, api_key, block_ids } = parsed.data;

  // If explicit blocks are passed, always delegate to the API since the
  // server resolves the composition from the schema_blocks library.
  if (block_ids && block_ids.length > 0) {
    if (!api_key || !deps.glyphApiUrl) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: 'Validating with explicit block_ids requires an api_key.',
          },
        ],
      };
    }
    const fetcher = deps.fetch ?? fetch;
    try {
      const res = await fetcher(`${deps.glyphApiUrl}/api/v1/validate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${api_key}`,
        },
        body: JSON.stringify({ document_type, structured_data, block_ids }),
      });
      const json = (await res.json()) as unknown;
      return { content: [{ type: 'text', text: JSON.stringify(json) }] };
    } catch (err) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Validation request failed: ${err instanceof Error ? err.message : 'unknown'}` }],
      };
    }
  }

  // Built-in types: use compile-time Zod schema (fast, no network).
  if (isBuiltInDocumentType(document_type)) {
    const schema = getSchema(document_type);
    const result = schema.safeParse(structured_data);
    const payload = result.success
      ? { valid: true, errors: [] }
      : {
          valid: false,
          errors: result.error.issues.map((i) => ({
            path: i.path.join('.'),
            message: i.message,
          })),
        };
    return { content: [{ type: 'text', text: JSON.stringify(payload) }] };
  }

  // Custom types: delegate to the Glyph API which resolves tenant schemas.
  if (api_key && deps.glyphApiUrl) {
    const fetcher = deps.fetch ?? fetch;
    try {
      const res = await fetcher(`${deps.glyphApiUrl}/api/v1/validate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${api_key}`,
        },
        body: JSON.stringify({ document_type, structured_data, block_ids }),
      });
      const json = (await res.json()) as unknown;
      return { content: [{ type: 'text', text: JSON.stringify(json) }] };
    } catch (err) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Validation request failed: ${err instanceof Error ? err.message : 'unknown'}` }],
      };
    }
  }

  return {
    isError: true,
    content: [{
      type: 'text',
      text: `Custom document type "${document_type}" requires an api_key to fetch its schema. Pass your Glyph API key.`,
    }],
  };
}
