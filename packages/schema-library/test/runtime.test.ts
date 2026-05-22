import { describe, expect, it } from 'vitest';
import { jsonSchemaToZod } from '../src/runtime.js';

describe('jsonSchemaToZod', () => {
  it('builds a string validator with length + format', () => {
    const z = jsonSchemaToZod({
      type: 'string',
      minLength: 3,
      format: 'email',
    });
    expect(z.safeParse('a@b.com').success).toBe(true);
    expect(z.safeParse('a').success).toBe(false);
    expect(z.safeParse('notemail').success).toBe(false);
  });

  it('builds a number validator with bounds', () => {
    const z = jsonSchemaToZod({ type: 'integer', minimum: 1, maximum: 10 });
    expect(z.safeParse(5).success).toBe(true);
    expect(z.safeParse(0).success).toBe(false);
    expect(z.safeParse(1.5).success).toBe(false);
  });

  it('builds an object with required + optional', () => {
    const z = jsonSchemaToZod({
      type: 'object',
      properties: {
        name: { type: 'string' },
        age: { type: 'integer' },
      },
      required: ['name'],
    });
    expect(z.safeParse({ name: 'x' }).success).toBe(true);
    expect(z.safeParse({}).success).toBe(false);
    expect(z.safeParse({ name: 'x', age: 10 }).success).toBe(true);
  });

  it('enforces additionalProperties: false', () => {
    const z = jsonSchemaToZod({
      type: 'object',
      properties: { a: { type: 'string' } },
      required: ['a'],
      additionalProperties: false,
    });
    expect(z.safeParse({ a: 'x' }).success).toBe(true);
    expect(z.safeParse({ a: 'x', b: 1 }).success).toBe(false);
  });

  it('builds arrays with minItems', () => {
    const z = jsonSchemaToZod({
      type: 'array',
      items: { type: 'string' },
      minItems: 2,
    });
    expect(z.safeParse(['a', 'b']).success).toBe(true);
    expect(z.safeParse(['a']).success).toBe(false);
  });

  it('handles enum + const', () => {
    const e = jsonSchemaToZod({ enum: ['red', 'blue'] });
    expect(e.safeParse('red').success).toBe(true);
    expect(e.safeParse('green').success).toBe(false);

    const c = jsonSchemaToZod({ const: 'only' });
    expect(c.safeParse('only').success).toBe(true);
    expect(c.safeParse('other').success).toBe(false);
  });

  it('handles anyOf / oneOf as a union', () => {
    const z = jsonSchemaToZod({
      anyOf: [{ type: 'string' }, { type: 'number' }],
    });
    expect(z.safeParse('x').success).toBe(true);
    expect(z.safeParse(1).success).toBe(true);
    expect(z.safeParse(true).success).toBe(false);
  });

  it('handles nullable types via [T, null]', () => {
    const z = jsonSchemaToZod({ type: ['string', 'null'] });
    expect(z.safeParse('x').success).toBe(true);
    expect(z.safeParse(null).success).toBe(true);
    expect(z.safeParse(1).success).toBe(false);
  });

  it('returns z.unknown() for empty / unsupported schema', () => {
    const z = jsonSchemaToZod({});
    expect(z.safeParse('anything').success).toBe(true);
    expect(z.safeParse({ foo: 'bar' }).success).toBe(true);
  });
});
