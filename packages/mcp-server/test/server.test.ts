import { describe, expect, it, vi } from 'vitest';
import { listTools, dispatchToolCall, createServer } from '../src/server.js';

describe('MCP server', () => {
  it('listTools returns the three Glyph tools', () => {
    const tools = listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain('structure_document');
    expect(names).toContain('validate_document');
    expect(names).toContain('generate_structured_document');
  });

  it('dispatchToolCall routes to the right handler', async () => {
    const r = await dispatchToolCall(
      'validate_document',
      {
        document_type: 'contract',
        structured_data: { document_type: 'contract' },
      },
      { glyphApiUrl: 'https://x' },
    );
    // validate handler returns a text result regardless
    expect(r.content[0]?.text).toBeDefined();
  });

  it('dispatchToolCall returns error for unknown tool', async () => {
    const r = await dispatchToolCall('mystery_tool', {}, {
      glyphApiUrl: 'https://x',
    });
    expect(r.isError).toBe(true);
  });

  it('createServer returns a server object without throwing', () => {
    const server = createServer({ glyphApiUrl: 'https://x' });
    expect(server).toBeDefined();
  });

  it('generate routes through dispatchToolCall with deps', async () => {
    const mockFetch = vi.fn(async () =>
      new Response(JSON.stringify({ downloadUrl: 'u', expiresIn: 3600 }), {
        status: 200,
      }),
    );
    const r = await dispatchToolCall(
      'generate_structured_document',
      {
        document_type: 'contract',
        structured_data: {},
        output_format: 'pdf',
        api_key: 'sk_live_x',
        title: 'T',
      },
      { glyphApiUrl: 'https://x', fetch: mockFetch as unknown as typeof fetch },
    );
    expect(r.isError).toBeUndefined();
  });
});
