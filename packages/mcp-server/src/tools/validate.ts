import { z } from 'zod';
import type { ToolResult } from './structure.js';

export const validateTool = {
  name: 'validate_document',
  description: `Validate a structured JSON payload against its Glyph schema. Pure validation — no LLM, no network beyond schema resolution.

USE THIS WHEN:
- You have composed a structured payload and want to confirm it will pass generate_structured_document's server-side check before calling it.
- You are ingesting third-party JSON and need to confirm it matches a Glyph schema before storing or signing it.

DO NOT USE THIS WHEN:
- You just want to know if a Glyph-stamped FILE is authentic — use read_glyph_payload (it verifies the Ed25519 signature as part of its return).
- You want to convert raw text to structured JSON — use structure_document.

INPUTS:
- document_type: any typeKey registered in your Glyph account.
- structured_data: object to validate.
- block_ids: optional composition (same as generate_structured_document).

RETURNS:
{ valid: true } on success, or
{ valid: false, errors: [ { path, message } ] } on validation failure.

PREFER this as a cheap pre-flight check before generate_structured_document if you are uncertain about the payload shape — it is much faster than getting a 422 from the generate call.`,
  inputSchema: {
    type: 'object',
    properties: {
      document_type: {
        type: 'string',
        description: 'Any document type key registered in your Glyph account (e.g. resume, contract, invoice, nda, offer_letter, purchase_order).',
      },
      structured_data: { type: 'object' },
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

  // All document types now resolve via /api/v1/validate — there are no
  // compile-time built-in Zod schemas in the MCP package anymore.
  if (!api_key || !deps.glyphApiUrl) {
    return {
      isError: true,
      content: [{
        type: 'text',
        text: `Document type "${document_type}" requires an api_key to fetch its schema. Pass your Glyph API key.`,
      }],
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
