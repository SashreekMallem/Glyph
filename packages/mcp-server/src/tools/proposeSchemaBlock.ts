import { z } from 'zod';
import type { ToolResult } from './structure.js';

/**
 * propose_schema_block — lets a connected AI extend Glyph's library when
 * the user is working in a domain we don't yet cover. The proposal lands
 * in the review queue; once approved it becomes available to everyone.
 */
export const proposeSchemaBlockTool = {
  name: 'propose_schema_block',
  description: `Propose a new schema block when the user works in a domain Glyph doesn't yet cover.

USE THIS WHEN:
- discover_schema returned no blocks for the user's domain.
- The user is working in a niche document type (veterinary records, pilot logbook, lab notebook, real-estate listing, etc.) that isn't in the core library.
- You would otherwise have to invent an ad-hoc structure for generate_structured_document — propose it as a reusable block first so the next user gets the same shape.

DO NOT USE THIS WHEN:
- A block already exists for the user's need. Run discover_schema first.
- The document is one-off / single-use. Just call generate_structured_document directly with a custom typeKey.

WHY: Glyph's value compounds when blocks are reusable. Each proposal teaches the system; future users in the same domain inherit the schema.

INPUTS:
- domain: snake_case domain name (e.g. "veterinary_record").
- proposed_name: short human-readable name (e.g. "Patient Visit").
- proposed_json_schema: JSON Schema Draft 7 object with type:"object", properties:{}, and required:[] populated.
- rationale: 1-2 sentences explaining the use case (optional).
- api_key: required.

RETURNS:
{ proposal_id, status: "pending", domain, message }

The proposal lands in Glyph's review queue. Once approved (usually <24h for sensible proposals) it becomes available to all users via discover_schema. Use the returned proposal_id to track status.`,
  inputSchema: {
    type: 'object',
    properties: {
      domain: { type: 'string', minLength: 1, maxLength: 64 },
      proposed_name: { type: 'string', minLength: 1, maxLength: 80 },
      proposed_json_schema: { type: 'object' },
      rationale: { type: 'string', maxLength: 500 },
      api_key: { type: 'string' },
    },
    required: ['domain', 'proposed_name', 'proposed_json_schema', 'api_key'],
  },
} as const;

const InputSchema = z.object({
  domain: z.string().min(1).max(64),
  proposed_name: z.string().min(1).max(80),
  proposed_json_schema: z.record(z.string(), z.unknown()),
  rationale: z.string().max(500).optional(),
  api_key: z.string().min(1),
});

export interface ProposeSchemaBlockDeps {
  readonly glyphApiUrl: string;
  readonly fetch?: typeof fetch;
}

export async function proposeSchemaBlockHandler(
  args: unknown,
  deps: ProposeSchemaBlockDeps,
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
    const res = await fetcher(`${deps.glyphApiUrl}/api/v1/schema-blocks/propose`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${parsed.data.api_key}`,
      },
      body: JSON.stringify({
        domain: parsed.data.domain,
        proposed_name: parsed.data.proposed_name,
        proposed_json_schema: parsed.data.proposed_json_schema,
        rationale: parsed.data.rationale,
      }),
    });
    const body = await res.json();
    if (!res.ok) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Propose failed (${res.status}): ${JSON.stringify(body)}`,
          },
        ],
      };
    }
    return { content: [{ type: 'text', text: JSON.stringify(body) }] };
  } catch (err) {
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: `Propose failed: ${err instanceof Error ? err.message : String(err)}`,
        },
      ],
    };
  }
}
