import { describe, expect, it } from 'vitest';
import { verifyMcpSecret, MCP_SECRET_HEADER } from '../src/auth.js';

describe('verifyMcpSecret', () => {
  it('rejects when expected is unset', () => {
    const r = verifyMcpSecret('x', undefined);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(500);
      expect(r.code).toBe('server_misconfigured');
    }
  });

  it('rejects when expected is empty string', () => {
    const r = verifyMcpSecret('x', '');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(500);
  });

  it('rejects missing header (null)', () => {
    const r = verifyMcpSecret(null, 'secret');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(401);
      expect(r.code).toBe('unauthorized');
    }
  });

  it('rejects missing header (undefined)', () => {
    const r = verifyMcpSecret(undefined, 'secret');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(401);
  });

  it('rejects empty header value', () => {
    const r = verifyMcpSecret('', 'secret');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(401);
  });

  it('rejects wrong secret', () => {
    const r = verifyMcpSecret('nope', 'secret');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(401);
      expect(r.code).toBe('unauthorized');
    }
  });

  it('rejects different-length secret without throwing', () => {
    const r = verifyMcpSecret('short', 'a-much-longer-secret');
    expect(r.ok).toBe(false);
  });

  it('accepts matching secret', () => {
    const r = verifyMcpSecret('s3cret-value', 's3cret-value');
    expect(r.ok).toBe(true);
  });

  it('exports lowercased header name', () => {
    expect(MCP_SECRET_HEADER).toBe('x-glyph-mcp-secret');
  });
});
