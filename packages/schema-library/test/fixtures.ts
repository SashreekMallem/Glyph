import type { Contract, Invoice, Resume } from '../src/index.js';

export const validContract: Contract = {
  document_type: 'contract',
  schema_version: '1.0.0',
  parties: [
    { name: 'Acme Inc.', role: 'client', email: 'legal@acme.com' },
    { name: 'Widgets Ltd.', role: 'vendor' },
  ],
  effective_date: '2026-01-01',
  expiry_date: '2027-01-01',
  payment_terms: {
    amount: 10000,
    currency: 'USD',
    schedule: 'monthly',
    due_days: 30,
  },
  obligations: [
    { party: 'Widgets Ltd.', description: 'Deliver widgets', deadline: '2026-06-01' },
  ],
  governing_law: 'State of Delaware, USA',
  confidentiality: true,
  termination_notice_days: 30,
};

export const validResume: Resume = {
  document_type: 'resume',
  schema_version: '1.0.0',
  personal: {
    full_name: 'Jane Doe',
    email: 'jane@example.com',
    phone: '+1-555-0100',
    linkedin: 'https://linkedin.com/in/janedoe',
    location: 'San Francisco, CA',
    website: 'https://janedoe.dev',
  },
  summary: 'Senior engineer focused on distributed systems.',
  experience: [
    {
      company: 'Acme',
      title: 'Staff Engineer',
      start_date: '2020-01-01',
      end_date: '2025-06-01',
      location: 'Remote',
      description: 'Led platform team.',
      achievements: ['Scaled ingest 10x', 'Hired 5 engineers'],
    },
  ],
  education: [
    {
      institution: 'MIT',
      degree: 'BS',
      field: 'Computer Science',
      graduation_year: 2019,
      gpa: 3.9,
    },
  ],
  skills: [
    { category: 'Languages', items: ['TypeScript', 'Rust', 'Go'] },
  ],
  certifications: [
    { name: 'AWS SAA', issuer: 'Amazon', issued_date: '2023-05-01' },
  ],
};

export const validInvoice: Invoice = {
  document_type: 'invoice',
  schema_version: '1.0.0',
  invoice_number: 'INV-0001',
  issue_date: '2026-04-01',
  due_date: '2026-05-01',
  vendor: { name: 'Widgets Ltd.', email: 'billing@widgets.com' },
  bill_to: { name: 'Acme Inc.', email: 'ap@acme.com' },
  line_items: [
    { description: 'Widget A', quantity: 10, unit_price: 100, total: 1000 },
  ],
  subtotal: 1000,
  tax_rate: 0.08,
  tax_amount: 80,
  total: 1080,
  currency: 'USD',
  notes: 'Thanks for your business.',
  payment_instructions: 'Wire to account 12345.',
};
