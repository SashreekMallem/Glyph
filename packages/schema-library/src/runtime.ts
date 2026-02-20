/**
 * Runtime JSON Schema → Zod converter.
 *
 * Glyph stores user-defined document types in the database as JSON
 * Schema (Draft 7). This module compiles a stored schema into a live
 * Zod validator so `safeParse` works identically to the built-in
 * compile-time schemas.
 *
 * Scope: supports the subset of JSON Schema we actually emit from
 * `zodToJsonSchema` + the shapes a sensible schema editor would produce.
 * Intentionally NOT a full JSON Schema implementation — if you need the
 * long tail (oneOf, allOf, $ref, remote refs), use a dedicated library.
 *
 * Supported:
 *  - type: string|number|integer|boolean|array|object|null
 *  - string: minLength, maxLength, pattern, format (email, date, uri), enum
 *  - number/integer: minimum, maximum, exclusiveMin/Max, multipleOf
 *  - array: items, minItems, maxItems
 *  - object: properties, required, additionalProperties (boolean only)
 *  - enum (top-level), const (top-level)
 *  - anyOf / oneOf (translated to z.union)
 *  - nullable via type: [..., "null"]
 *
 * Ignored (silently): $id, $schema, title, description, examples,
 * default, readOnly, writeOnly.
 *
 * Unknown constructs produce `z.unknown()` rather than throwing — this
 * keeps user-defined types forgiving.
 */

import { z, type ZodTypeAny } from 'zod';
import type { JSONSchema7, JSONSchema7Definition, JSONSchema7TypeName } from 'json-schema';

type JsonSchema = JSONSchema7;
type JsonSchemaDef = JSONSchema7Definition;

function isSchemaObject(def: JsonSchemaDef): def is JsonSchema {
  return typeof def === 'object' && def !== null;
}

function asArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

function buildString(schema: JsonSchema): ZodTypeAny {
  let s = z.string();
  if (typeof schema.minLength === 'number') s = s.min(schema.minLength);
  if (typeof schema.maxLength === 'number') s = s.max(schema.maxLength);
  if (typeof schema.pattern === 'string') s = s.regex(new RegExp(schema.pattern));
  if (schema.format === 'email') s = s.email();
  if (schema.format === 'uri') s = s.url();
  if (schema.format === 'uuid') s = s.uuid();
  if (schema.format === 'date') s = s.regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');
  if (schema.format === 'date-time') s = s.datetime();
  return s;
}

function buildNumber(schema: JsonSchema, integer: boolean): ZodTypeAny {
  let n = integer ? z.number().int() : z.number();
  if (typeof schema.minimum === 'number') n = n.min(schema.minimum);
  if (typeof schema.maximum === 'number') n = n.max(schema.maximum);
  if (typeof schema.exclusiveMinimum === 'number') n = n.gt(schema.exclusiveMinimum);
  if (typeof schema.exclusiveMaximum === 'number') n = n.lt(schema.exclusiveMaximum);
  if (typeof schema.multipleOf === 'number') n = n.multipleOf(schema.multipleOf);
  return n;
}

function buildArray(schema: JsonSchema): ZodTypeAny {
  const itemsDef = Array.isArray(schema.items) ? schema.items[0] : schema.items;
  const itemSchema = itemsDef !== undefined && isSchemaObject(itemsDef)
    ? jsonSchemaToZod(itemsDef)
    : z.unknown();
  let arr = z.array(itemSchema);
  if (typeof schema.minItems === 'number') arr = arr.min(schema.minItems);
  if (typeof schema.maxItems === 'number') arr = arr.max(schema.maxItems);
  return arr;
}

function buildObject(schema: JsonSchema): ZodTypeAny {
  const shape: Record<string, ZodTypeAny> = {};
  const required = new Set<string>(Array.isArray(schema.required) ? schema.required : []);
  const props = schema.properties ?? {};
  for (const [key, def] of Object.entries(props)) {
    if (!isSchemaObject(def)) {
      shape[key] = z.unknown();
      continue;
    }
    const inner = jsonSchemaToZod(def);
    shape[key] = required.has(key) ? inner : inner.optional();
  }
  const base = z.object(shape);
  if (schema.additionalProperties === false) {
    return base.strict();
  }
  return base;
}

function buildEnum(values: readonly unknown[]): ZodTypeAny {
  const literals: ZodTypeAny[] = values.map((v) => z.literal(v as z.Primitive));
  if (literals.length === 0) return z.never();
  if (literals.length === 1) return literals[0]!;
  return z.union(literals as unknown as [ZodTypeAny, ZodTypeAny, ...ZodTypeAny[]]);
}

function buildByType(schema: JsonSchema, type: JSONSchema7TypeName): ZodTypeAny {
  switch (type) {
    case 'string':
      return buildString(schema);
    case 'number':
      return buildNumber(schema, false);
    case 'integer':
      return buildNumber(schema, true);
    case 'boolean':
      return z.boolean();
    case 'null':
      return z.null();
    case 'array':
      return buildArray(schema);
    case 'object':
      return buildObject(schema);
  }
}

/**
 * Convert a JSON Schema object into a live Zod validator. Non-strict:
 * unsupported constructs fall through to `z.unknown()`.
 */
export function jsonSchemaToZod(schema: JsonSchema): ZodTypeAny {
  if (Array.isArray(schema.const)) return z.literal(schema.const as unknown as z.Primitive);
  if (schema.const !== undefined) return z.literal(schema.const as z.Primitive);
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return buildEnum(schema.enum);

  if (Array.isArray(schema.anyOf) || Array.isArray(schema.oneOf)) {
    const branches = [
      ...(schema.anyOf ?? []),
      ...(schema.oneOf ?? []),
    ].filter(isSchemaObject).map(jsonSchemaToZod);
    if (branches.length === 0) return z.unknown();
    if (branches.length === 1) return branches[0]!;
    return z.union(branches as [ZodTypeAny, ZodTypeAny, ...ZodTypeAny[]]);
  }

  const types = asArray(schema.type);
  const nullable = types.includes('null');
  const nonNull = types.filter((t): t is JSONSchema7TypeName => t !== 'null');

  if (nonNull.length === 0) return nullable ? z.null() : z.unknown();

  if (nonNull.length === 1) {
    const base = buildByType(schema, nonNull[0]!);
    return nullable ? base.nullable() : base;
  }

  const branches = nonNull.map((t) => buildByType(schema, t));
  const union = z.union(branches as [ZodTypeAny, ZodTypeAny, ...ZodTypeAny[]]);
  return nullable ? union.nullable() : union;
}
