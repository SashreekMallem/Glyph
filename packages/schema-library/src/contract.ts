import { z } from 'zod';

const PartyRoleEnum = z.enum([
  'client',
  'vendor',
  'employer',
  'employee',
  'landlord',
  'tenant',
  'buyer',
  'seller',
  'licensor',
  'licensee',
  'party',
]);

const PartySchema = z
  .object({
    name: z.string().min(1, 'party.name must be non-empty'),
    role: PartyRoleEnum,
    address: z.string().min(1).optional(),
    email: z.string().email().optional(),
  })
  .strict();

const PaymentTermsSchema = z
  .object({
    amount: z.number().nonnegative().optional(),
    currency: z
      .string()
      .length(3, 'currency must be a 3-letter ISO 4217 code')
      .optional(),
    schedule: z
      .enum(['upfront', 'monthly', 'quarterly', 'annually', 'on_delivery', 'net_30', 'net_60', 'net_90', 'milestone'])
      .optional(),
    due_days: z.number().int().positive().optional(),
  })
  .strict();

const ObligationSchema = z
  .object({
    party: z.string().min(1),
    description: z.string().min(1),
    deadline: z.string().date().optional(),
  })
  .strict();

export const ContractSchema = z
  .object({
    document_type: z.literal('contract'),
    schema_version: z.string().min(1),

    parties: z.array(PartySchema).min(2, 'a contract has at least two parties'),
    effective_date: z.string().date(),
    expiry_date: z.string().date().optional(),

    payment_terms: PaymentTermsSchema.optional(),
    obligations: z.array(ObligationSchema),
    governing_law: z.string().min(1, 'governing_law is required'),
    confidentiality: z.boolean().default(false),
    termination_notice_days: z.number().int().positive().optional(),
  })
  .strict();

export type Contract = z.infer<typeof ContractSchema>;
