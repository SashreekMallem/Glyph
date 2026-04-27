/**
 * Edge auth for the MCP HTTP route.
 *
 * Verifies the `X-Glyph-MCP-Secret` header against `MCP_SERVER_SECRET`
 * (env-bound). Uses timing-safe comparison.
 */

import { timingSafeEqual } from 'node:crypto';

export interface AuthOk {
  readonly ok: true;
}
export interface AuthFail {
  readonly ok: false;
  readonly status: number;
  readonly code: string;
  readonly message: string;
}
export type AuthResult = AuthOk | AuthFail;

const HEADER_NAME = 'x-glyph-mcp-secret';

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function verifyMcpSecret(
  headerValue: string | null | undefined,
  expected: string | undefined,
): AuthResult {
  if (expected === undefined || expected.length === 0) {
    return {
      ok: false,
      status: 500,
      code: 'server_misconfigured',
      message: 'MCP_SERVER_SECRET is not configured on the server.',
    };
  }
  if (headerValue === null || headerValue === undefined || headerValue.length === 0) {
    return {
      ok: false,
      status: 401,
      code: 'unauthorized',
      message: `Missing ${HEADER_NAME} header.`,
    };
  }
  if (!safeEqual(headerValue, expected)) {
    return {
      ok: false,
      status: 401,
      code: 'unauthorized',
      message: 'Invalid MCP secret.',
    };
  }
  return { ok: true };
}

export const MCP_SECRET_HEADER = HEADER_NAME;
