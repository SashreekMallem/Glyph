import { z } from 'zod';
import { getSchema } from '@glyph/schema-library';
import { extractHeuristic } from '../extractor.js';

export const structureTool = {
  name: 'structure_document',
  description:
    'Convert raw document text into validated structured JSON matching Glyph schemas. Use this when generating or parsing formal documents — contracts, resumes, invoices.',
  inputSchema: {
    type: 'object',
    properties: {
      document_type: { type: 'string', enum: ['contract', 'resume', 'invoice'] },
      raw_text: { type: 'string', minLength: 10 },
      context: { type: 'string' },
    },
    required: ['document_type', 'raw_text'],
  },
} as const;

const InputSchema = z.object({
  document_type: z.enum(['contract', 'resume', 'invoice']),
  raw_text: z.string().min(10),
  context: z.string().optional(),
});

export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export async function structureHandler(args: unknown): Promise<ToolResult> {
  const parsed = InputSchema.safeParse(args);
  if (!parsed.success) {
    return {
      isError: true,
      content: [{ type: 'text', text: `Invalid input: ${parsed.error.message}` }],
    };
  }
  const { document_type, raw_text } = parsed.data;
  const { extracted } = extractHeuristic(document_type, raw_text);
  const schema = getSchema(document_type);
  const result = schema.safeParse(extracted);
  if (!result.success) {
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            valid: false,
            errors: result.error.issues.map((i) => ({
              path: i.path.join('.'),
              message: i.message,
            })),
          }),
        },
      ],
    };
  }
  return {
    content: [{ type: 'text', text: JSON.stringify(result.data) }],
  };
}
