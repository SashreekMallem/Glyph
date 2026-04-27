import { describe, expect, it } from 'vitest';

import {
  ContractSchema,
  DocumentSchema,
  InvoiceSchema,
  ResumeSchema,
  getSchema,
} from '../src/index.js';
import { validContract, validInvoice, validResume } from './fixtures.js';

describe('registry', () => {
  it('getSchema returns the correct schemas', () => {
    expect(getSchema('contract')).toBe(ContractSchema);
    expect(getSchema('resume')).toBe(ResumeSchema);
    expect(getSchema('invoice')).toBe(InvoiceSchema);
  });

  it('getSchema throws on an unknown type', () => {
    expect(() => getSchema('nope' as 'contract')).toThrow();
  });

  it('DocumentSchema accepts each valid fixture', () => {
    expect(DocumentSchema.safeParse(validContract).success).toBe(true);
    expect(DocumentSchema.safeParse(validResume).success).toBe(true);
    expect(DocumentSchema.safeParse(validInvoice).success).toBe(true);
  });

  it('DocumentSchema discriminates on document_type', () => {
    const bad = { ...validContract, document_type: 'whatever' };
    expect(DocumentSchema.safeParse(bad).success).toBe(false);
  });

  it('DocumentSchema failure paths point at the field', () => {
    const bad = { ...validContract, effective_date: 'nope' };
    const res = DocumentSchema.safeParse(bad);
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues.some((i) => i.path.includes('effective_date'))).toBe(true);
    }
  });
});
