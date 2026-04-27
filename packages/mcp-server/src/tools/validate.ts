import { z } from 'zod';
import { getSchema } from '@glyph/schema-library';
import type { ToolResult } from './structure.js';

export const validateTool = {
  name: 'validate_document',
  description:
    'Validate structured document JSON against its Glyph schema. Returns valid:true or a list of errors.',
  inputSchema: {
    type: 'object',
    properties: {
      document_type: { type: 'string', enum: ['contract', 'resume', 'invoice'] },
      structured_data: { type: 'object' },
    },
    required: ['document_type', 'structured_data'],
  },
} as const;

const InputSchema = z.object({
  document_type: z.enum(['contract', 'resume', 'invoice']),
  structured_data: z.record(z.string(), z.unknown()),
});

export async function validateHandler(args: unknown): Promise<ToolResult> {
  const parsed = InputSchema.safeParse(args);
  if (!parsed.success) {
    return {
      isError: true,
      content: [{ type: 'text', text: `Invalid input: ${parsed.error.message}` }],
    };
  }
  const { document_type, structured_data } = parsed.data;
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
