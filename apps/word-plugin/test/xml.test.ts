import { describe, it, expect } from 'vitest';

import {
  buildStructuredXml,
  escapeXml,
  GLYPH_XML_NAMESPACE,
} from '../src/taskpane/lib/xml';

describe('escapeXml', () => {
  it('escapes all five XML predefined entities', () => {
    expect(escapeXml(`<>&"'`)).toBe('&lt;&gt;&amp;&quot;&apos;');
  });

  it('escapes & first so other escapes are not double-encoded', () => {
    expect(escapeXml('&amp;')).toBe('&amp;amp;');
    expect(escapeXml('A & B')).toBe('A &amp; B');
  });

  it('leaves plain strings untouched', () => {
    expect(escapeXml('Hello World 123')).toBe('Hello World 123');
  });
});

describe('buildStructuredXml', () => {
  const base = {
    documentType: 'contract',
    schemaVersion: '1.0',
    encrypted: 'ZW5j',
    iv: 'aXY=',
    tag: 'dGFn',
    signature: 'c2ln',
    timestamp: '2026-04-23T00:00:00.000Z',
  } as const;

  it('declares the Glyph namespace on the root element', () => {
    const xml = buildStructuredXml(base);
    expect(xml).toContain(`xmlns="${GLYPH_XML_NAMESPACE}"`);
    expect(GLYPH_XML_NAMESPACE).toBe('https://glyph.dev/schemas/v1');
  });

  it('emits every required element exactly once', () => {
    const xml = buildStructuredXml(base);
    for (const tag of [
      'StructuredDocument',
      'DocumentType',
      'SchemaVersion',
      'EncryptedPayload',
      'IV',
      'Tag',
      'Signature',
      'Timestamp',
    ]) {
      const opens = xml.split(`<${tag}`).length - 1;
      const closes = xml.split(`</${tag}>`).length - 1;
      expect(opens, `${tag} open count`).toBe(1);
      expect(closes, `${tag} close count`).toBe(1);
    }
  });

  it('escapes hostile text inside element content', () => {
    const xml = buildStructuredXml({
      ...base,
      documentType: '<contract>&"evil\'',
    });
    expect(xml).toContain(
      '<DocumentType>&lt;contract&gt;&amp;&quot;evil&apos;</DocumentType>',
    );
    // The escaping must not corrupt surrounding markup.
    expect(xml).toContain('<SchemaVersion>1.0</SchemaVersion>');
  });

  it('includes the provided timestamp verbatim', () => {
    expect(buildStructuredXml(base)).toContain(
      '<Timestamp>2026-04-23T00:00:00.000Z</Timestamp>',
    );
  });

  it('defaults the timestamp to a valid ISO-8601 string when omitted', () => {
    const xml = buildStructuredXml({ ...base, timestamp: undefined });
    const m = /<Timestamp>([^<]+)<\/Timestamp>/.exec(xml);
    expect(m).not.toBeNull();
    if (m === null) return;
    expect(new Date(m[1] as string).toString()).not.toBe('Invalid Date');
  });

  it('accepts malformed base64 without throwing (server validates downstream)', () => {
    const xml = buildStructuredXml({
      ...base,
      encrypted: '!!not base64!!',
      iv: '',
      tag: 'a b c',
      signature: '===',
    });
    expect(xml).toContain('<EncryptedPayload>!!not base64!!</EncryptedPayload>');
    expect(xml).toContain('<IV></IV>');
    expect(xml).toContain('<Tag>a b c</Tag>');
    expect(xml).toContain('<Signature>===</Signature>');
  });

  it('begins with the XML prolog', () => {
    expect(buildStructuredXml(base).startsWith('<?xml version="1.0"')).toBe(true);
  });
});
