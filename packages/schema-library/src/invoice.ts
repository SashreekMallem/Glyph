import { z } from 'zod';

const ContactSchema = z
  .object({
    name: z.string().min(1),
    address: z.string().min(1).optional(),
    email: z.string().email().optional(),
    phone: z.string().min(1).optional(),
    tax_id: z.string().min(1).optional(),
  })
  .strict();

const LineItemSchema = z
  .object({
    description: z.string().min(1),
    quantity: z.number().positive(),
    unit_price: z.number().nonnegative(),
    total: z.number().nonnegative(),
  })
  .strict();

export const InvoiceSchema = z
  .object({
    document_type: z.literal('invoice'),
    schema_version: z.string().min(1),

    invoice_number: z.string().min(1),
    issue_date: z.string().date(),
    due_date: z.string().date(),

    vendor: ContactSchema,
    bill_to: ContactSchema,

    line_items: z.array(LineItemSchema).min(1, 'an invoice needs at least one line item'),

    subtotal: z.number().nonnegative(),
    tax_rate: z.number().min(0).max(1).optional(),
    tax_amount: z.number().nonnegative().optional(),
    total: z.number().positive(),
    currency: z.string().length(3, 'currency must be a 3-letter ISO 4217 code'),

    notes: z.string().min(1).optional(),
    payment_instructions: z.string().min(1).optional(),
  })
  .strict();

export type Invoice = z.infer<typeof InvoiceSchema>;
