import type { JSONSchema7 } from 'json-schema';
import type { ZodType } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

/**
 * Convert a Zod schema to a JSON Schema document.
 *
 * `zod-to-json-schema` emits Draft 7 output; we stamp `$schema` to the
 * draft-07 URI accordingly. If/when the upstream library gains stable
 * 2020-12 support we can switch the `target` option and the `$schema`
 * string together.
 */
export function toJsonSchema(schema: ZodType): JSONSchema7 {
  const out = zodToJsonSchema(schema, {
    target: 'jsonSchema7',
    $refStrategy: 'none',
  }) as JSONSchema7;
  return {
    $schema: 'http://json-schema.org/draft-07/schema#',
    ...out,
  };
}
