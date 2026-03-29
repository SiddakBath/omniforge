import type { BuiltinToolSpec } from './types.js';
import { clampTimeout, normalizeHeaders, withTimeoutSignal } from './utils.js';

export const httpRequestTool: BuiltinToolSpec = {
  definition: {
    category: 'builtin',
    name: 'http_request',
    description: 'Make an HTTP request with optional JSON parsing.',
    parameters: {
      type: 'object',
      properties: {
        method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] },
        url: { type: 'string' },
        headers: { type: 'object', additionalProperties: { type: 'string' } },
        body: { type: 'string' },
        timeout_ms: { type: 'number', default: 30000 },
        parse_json: { type: 'boolean', default: false },
        fail_on_http_error: { type: 'boolean', default: false },
      },
      required: ['method', 'url'],
    },
  },
  execute: async (call) => {
    const method = String(call.input.method ?? 'GET').toUpperCase();
    const url = String(call.input.url ?? '').trim();

    if (!url) {
      return { ok: false, output: 'url is required' };
    }

    const headers = normalizeHeaders(call.input.headers);
    const body = call.input.body !== undefined ? String(call.input.body) : undefined;
    const timeoutMs = clampTimeout(call.input.timeout_ms ?? call.input.timeoutMs, 30_000, 120_000);
    const parseJson = Boolean(call.input.parse_json ?? false);
    const failOnHttpError = Boolean(call.input.fail_on_http_error ?? false);

    const timeout = withTimeoutSignal(timeoutMs);
    try {
      const requestInit: RequestInit = {
        method,
        headers,
        signal: timeout.signal,
      };

      if (body !== undefined) {
        requestInit.body = body;
      }

      const response = await fetch(url, requestInit);
      const text = await response.text();

      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });

      const result: Record<string, unknown> = {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
        body: text,
      };

      if (parseJson) {
        try {
          result.json = JSON.parse(text);
        } catch {
          result.json = undefined;
        }
      }

      if (!response.ok && failOnHttpError) {
        return { ok: false, output: `HTTP ${response.status}: ${text || response.statusText}` };
      }

      return { ok: true, output: JSON.stringify(result, null, 2) };
    } catch (error) {
      return { ok: false, output: error instanceof Error ? error.message : 'HTTP request failed.' };
    } finally {
      timeout.clear();
    }
  },
};
