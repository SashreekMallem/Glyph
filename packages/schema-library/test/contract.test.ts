import { describe, expect, it } from 'vitest';

import { ContractSchema } from '../src/index.js';
import { validContract } from './fixtures.js';

describe('ContractSchema', () => {
  it('parses a valid fixture', () => {
    const out = ContractSchema.parse(validContract);
    expect(out.document_type).toBe('contract');
  });

  it('defaults confidentiality to false when omitted', () => {
    const { confidentiality: _c, ...rest } = validContract;
    const out = ContractSchema.parse(rest);
    expect(out.confidentiality).toBe(false);
  });

  it('rejects fewer than two parties', () => {
    const bad = { ...validContract, parties: [validContract.parties[0]!] };
    const res = ContractSchema.safeParse(bad);
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues[0]?.path).toEqual(['parties']);
    }
  });

  it('rejects missing governing_law', () => {
    const { governing_law: _g, ...bad } = validContract;
    const res = ContractSchema.safeParse(bad);
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues.some((i) => i.path.includes('governing_law'))).toBe(true);
    }
  });

  it('rejects empty governing_law', () => {
    const res = ContractSchema.safeParse({ ...validContract, governing_law: '' });
    expect(res.success).toBe(false);
  });

  it('rejects bad effective_date format', () => {
    const res = ContractSchema.safeParse({ ...validContract, effective_date: '2026/01/01' });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues[0]?.path).toEqual(['effective_date']);
    }
  });

  it('rejects invalid currency length', () => {
    const res = ContractSchema.safeParse({
      ...validContract,
      payment_terms: { currency: 'DOLLAR' },
    });
    expect(res.success).toBe(false);
  });

  it('rejects invalid party email', () => {
    const res = ContractSchema.safeParse({
      ...validContract,
      parties: [
        { name: 'x', role: 'client', email: 'not-an-email' },
        validContract.parties[1]!,
      ],
    });
    expect(res.success).toBe(false);
  });

  it('rejects invalid role enum', () => {
    const res = ContractSchema.safeParse({
      ...validContract,
      parties: [
        { name: 'x', role: 'wizard' },
        validContract.parties[1]!,
      ],
    });
    expect(res.success).toBe(false);
  });

  it('rejects unknown top-level fields (strict)', () => {
    const res = ContractSchema.safeParse({ ...validContract, sneaky: true });
    expect(res.success).toBe(false);
  });

  it('rejects wrong document_type literal', () => {
    const res = ContractSchema.safeParse({ ...validContract, document_type: 'resume' });
    expect(res.success).toBe(false);
  });

  it('rejects missing document_type', () => {
    const { document_type: _d, ...bad } = validContract;
    const res = ContractSchema.safeParse(bad);
    expect(res.success).toBe(false);
  });

  it('rejects non-positive termination_notice_days', () => {
    const res = ContractSchema.safeParse({ ...validContract, termination_notice_days: 0 });
    expect(res.success).toBe(false);
  });
});
