/**
 * Heuristic extractor — local copy for the MCP server.
 *
 * Mirrors `apps/web/src/lib/extract/heuristic.ts` at the time of writing.
 * Kept separate so this package does not depend on the Next.js app's
 * internal `@/lib/*` paths. If the canonical heuristic gains new fields,
 * sync this file in lockstep (both are versioned by the `schema_version`
 * field they write).
 *
 * Zero `any`. Pure functions. No I/O, no global state.
 */

import type { DocumentType } from '@glyph/schema-library';

export interface HeuristicResult {
  readonly extracted: Record<string, unknown>;
  readonly missingFields: readonly string[];
  readonly valid: boolean;
}

const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const PHONE_RE = /\b(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/;
const URL_RE = /\bhttps?:\/\/[^\s)]+/i;
const ISO_DATE_RE = /\b(\d{4})-(\d{2})-(\d{2})\b/;
const CURRENCY_RE = /\b(USD|EUR|GBP|CAD|AUD|JPY|CHF)\b/i;
const AMOUNT_RE = /\$\s*([\d,]+(?:\.\d{1,2})?)/;
const INVOICE_NUM_RE = /invoice\s*(?:#|number|no\.?)\s*[:\-]?\s*([A-Z0-9\-_]+)/i;

function firstMatch(text: string, re: RegExp): string | null {
  const m = re.exec(text);
  return m?.[0] ?? null;
}

function firstGroup(text: string, re: RegExp, group: number): string | null {
  const m = re.exec(text);
  return m?.[group] ?? null;
}

function extractContract(text: string): HeuristicResult {
  const extracted: Record<string, unknown> = {
    document_type: 'contract',
    schema_version: '1.0',
  };
  const missing: string[] = [];

  const parties: Array<{ name: string; role: string }> = [];
  const between = /between\s+([^,\n]{2,80}?)\s+(?:and|&)\s+([^,\n.]{2,80})/i.exec(
    text,
  );
  if (between?.[1] && between[2]) {
    parties.push({ name: between[1].trim(), role: 'party' });
    parties.push({ name: between[2].trim(), role: 'party' });
  }
  if (parties.length >= 2) {
    extracted.parties = parties;
  } else {
    missing.push('parties');
  }

  const effective = /effective\s+(?:date|as\s+of)[:\s]+(\d{4}-\d{2}-\d{2})/i.exec(
    text,
  );
  if (effective?.[1]) {
    extracted.effective_date = effective[1];
  } else {
    const iso = firstMatch(text, ISO_DATE_RE);
    if (iso !== null) {
      extracted.effective_date = iso;
    } else {
      missing.push('effective_date');
    }
  }

  const governing = /governing\s+law[:\s]+([^\n.]{2,80})/i.exec(text);
  if (governing?.[1]) {
    extracted.governing_law = governing[1].trim();
  } else {
    missing.push('governing_law');
  }

  extracted.obligations = [];
  extracted.confidentiality = /\bconfidential(?:ity)?\b/i.test(text);

  return {
    extracted,
    missingFields: missing,
    valid: missing.length === 0,
  };
}

function extractResume(text: string): HeuristicResult {
  const extracted: Record<string, unknown> = {
    document_type: 'resume',
    schema_version: '1.0',
  };
  const missing: string[] = [];

  const email = firstMatch(text, EMAIL_RE);
  const firstLine = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0 && l.length < 80 && !EMAIL_RE.test(l));

  if (email !== null && firstLine !== undefined) {
    const personal: Record<string, string> = {
      full_name: firstLine,
      email,
    };
    const phone = firstMatch(text, PHONE_RE);
    if (phone !== null) personal.phone = phone;
    const url = firstMatch(text, URL_RE);
    if (url !== null) personal.website = url;
    extracted.personal = personal;
  } else {
    if (email === null) missing.push('personal.email');
    if (firstLine === undefined) missing.push('personal.full_name');
  }

  extracted.experience = [];
  extracted.education = [];
  extracted.skills = [];

  return {
    extracted,
    missingFields: missing,
    valid: missing.length === 0,
  };
}

function extractInvoice(text: string): HeuristicResult {
  const extracted: Record<string, unknown> = {
    document_type: 'invoice',
    schema_version: '1.0',
  };
  const missing: string[] = [];

  const invoiceNumber = firstGroup(text, INVOICE_NUM_RE, 1);
  if (invoiceNumber !== null) {
    extracted.invoice_number = invoiceNumber;
  } else {
    missing.push('invoice_number');
  }

  const issueMatch = /issue(?:d)?\s*(?:date)?[:\s]+(\d{4}-\d{2}-\d{2})/i.exec(text);
  if (issueMatch?.[1]) {
    extracted.issue_date = issueMatch[1];
  } else {
    missing.push('issue_date');
  }

  const dueMatch = /due\s*(?:date)?[:\s]+(\d{4}-\d{2}-\d{2})/i.exec(text);
  if (dueMatch?.[1]) {
    extracted.due_date = dueMatch[1];
  } else {
    missing.push('due_date');
  }

  const currency = firstMatch(text, CURRENCY_RE);
  if (currency !== null) {
    extracted.currency = currency.toUpperCase();
  } else {
    missing.push('currency');
  }

  const totalMatch = /total[:\s]+\$?\s*([\d,]+(?:\.\d{1,2})?)/i.exec(text);
  const total = totalMatch?.[1] ?? firstGroup(text, AMOUNT_RE, 1);
  if (total !== null && total !== undefined) {
    const num = Number.parseFloat(total.replace(/,/g, ''));
    if (Number.isFinite(num) && num > 0) {
      extracted.total = num;
      extracted.subtotal = num;
    } else {
      missing.push('total');
    }
  } else {
    missing.push('total');
  }

  extracted.line_items = [];
  extracted.vendor = { name: '' };
  extracted.bill_to = { name: '' };

  return {
    extracted,
    missingFields: missing,
    valid: missing.length === 0,
  };
}

/**
 * Run the heuristic extractor for the given document type.
 */
export function extractHeuristic(
  type: DocumentType,
  text: string,
): HeuristicResult {
  switch (type) {
    case 'contract':
      return extractContract(text);
    case 'resume':
      return extractResume(text);
    case 'invoice':
      return extractInvoice(text);
  }
}
