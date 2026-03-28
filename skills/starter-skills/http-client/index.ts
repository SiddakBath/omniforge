type Context = {
  toolName: string;
  input: Record<string, unknown>;
};

function normalizeHeaders(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  const headers: Record<string, string> = {};
  for (const [key, val] of Object.entries(value)) {
    if (typeof val === 'string') {
      headers[key] = val;
    }
  }
  return headers;
}

function clampTimeout(value: unknown): number {
  const raw = Number(value);
  if (!Number.isFinite(raw)) {
    return 30_000;
  }
  return Math.max(1_000, Math.min(120_000, Math.floor(raw)));
}

function withTimeoutSignal(timeoutMs: number): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('HTTP request timed out')), timeoutMs);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timer),
  };
}

export async function runTool(context: Context) {
  if (context.toolName !== 'http_request') {
    throw new Error(`Unsupported tool: ${context.toolName}`);
  }

  const method = String(context.input.method ?? 'GET').toUpperCase();
  const url = String(context.input.url ?? '').trim();
  if (!url) {
    throw new Error('url is required');
  }

  const headers = normalizeHeaders(context.input.headers);
  const body = context.input.body !== undefined ? String(context.input.body) : undefined;
  const timeoutMs = clampTimeout(context.input.timeout_ms ?? context.input.timeoutMs);
  const parseJson = Boolean(context.input.parse_json ?? false);
  const failOnHttpError = Boolean(context.input.fail_on_http_error ?? false);

  const timeout = withTimeoutSignal(timeoutMs);
  try {
    const response = await fetch(url, {
      method,
      headers,
      body,
      signal: timeout.signal,
    });

    const text = await response.text();
    const result: Record<string, unknown> = {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers.entries()),
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
      throw new Error(`HTTP ${response.status}: ${text || response.statusText}`);
    }

    return result;
  } finally {
    timeout.clear();
  }
}
