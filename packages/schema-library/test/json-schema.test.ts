import { describe, expect, it } from 'vitest';

import {
  ContractSchema,
  InvoiceSchema,
  ResumeSchema,
  toJsonSchema,
} from '../src/index.js';

describe('toJsonSchema', () => {
  it('emits an object schema with required metadata', () => {
    const out = toJsonSchema(ContractSchema);
    expect(out.$schema).toBe('http://json-schema.org/draft-07/schema#');
    expect(out.type).toBe('object');
    expect(out.properties).toBeDefined();
    expect(Array.isArray(out.required)).toBe(true);
  });

  it('snapshot: contract', () => {
    expect(toJsonSchema(ContractSchema)).toMatchSnapshot();
  });

  it('snapshot: resume', () => {
    expect(toJsonSchema(ResumeSchema)).toMatchSnapshot();
  });

  it('snapshot: invoice', () => {
    expect(toJsonSchema(InvoiceSchema)).toMatchSnapshot();
  });
});
