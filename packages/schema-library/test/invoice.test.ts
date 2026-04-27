import { describe, expect, it } from 'vitest';

import { InvoiceSchema } from '../src/index.js';
import { validInvoice } from './fixtures.js';

describe('InvoiceSchema', () => {
  it('parses a valid fixture', () => {
    expect(InvoiceSchema.parse(validInvoice).document_type).toBe('invoice');
  });

  it('rejects empty line_items', () => {
    const res = InvoiceSchema.safeParse({ ...validInvoice, line_items: [] });
    expect(res.success).toBe(false);
  });

  it('rejects non-positive quantity', () => {
    const res = InvoiceSchema.safeParse({
      ...validInvoice,
      line_items: [{ ...validInvoice.line_items[0]!, quantity: 0 }],
    });
    expect(res.success).toBe(false);
  });

  it('rejects negative unit_price', () => {
    const res = InvoiceSchema.safeParse({
      ...validInvoice,
      line_items: [{ ...validInvoice.line_items[0]!, unit_price: -1 }],
    });
    expect(res.success).toBe(false);
  });

  it('rejects negative total on line item', () => {
    const res = InvoiceSchema.safeParse({
      ...validInvoice,
      line_items: [{ ...validInvoice.line_items[0]!, total: -1 }],
    });
    expect(res.success).toBe(false);
  });

  it('rejects non-positive total', () => {
    const res = InvoiceSchema.safeParse({ ...validInvoice, total: 0 });
    expect(res.success).toBe(false);
  });

  it('rejects bad currency length', () => {
    const res = InvoiceSchema.safeParse({ ...validInvoice, currency: 'US' });
    expect(res.success).toBe(false);
  });

  it('rejects bad issue_date', () => {
    const res = InvoiceSchema.safeParse({ ...validInvoice, issue_date: 'soon' });
    expect(res.success).toBe(false);
  });

  it('rejects missing invoice_number', () => {
    const { invoice_number: _i, ...bad } = validInvoice;
    expect(InvoiceSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects tax_rate > 1', () => {
    const res = InvoiceSchema.safeParse({ ...validInvoice, tax_rate: 2 });
    expect(res.success).toBe(false);
  });

  it('rejects unknown top-level fields', () => {
    const res = InvoiceSchema.safeParse({ ...validInvoice, mystery: true });
    expect(res.success).toBe(false);
  });

  it('rejects bad vendor email', () => {
    const res = InvoiceSchema.safeParse({
      ...validInvoice,
      vendor: { name: 'x', email: 'nope' },
    });
    expect(res.success).toBe(false);
  });
});
