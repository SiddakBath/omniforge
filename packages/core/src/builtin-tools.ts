export { getBuiltinToolDefinitions, executeBuiltinTool } from './builtin-tools/registry.js';
export type { BuiltinToolContext } from './builtin-tools/types.js';

/*

const BUILTIN_TOOLS: ToolDefinition[] = [
  {
    category: 'builtin',
    name: 'read_file',
    description: 'Read UTF-8 text from a file inside the workspace.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Workspace-relative file path.' },
      },
      required: ['path'],
    },
  },
  {
    category: 'builtin',
    name: 'write_file',
    description: 'Write UTF-8 text to a file inside the workspace.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Workspace-relative file path.' },
        content: { type: 'string', description: 'Content to write.' },
        append: { type: 'boolean', default: false },
      },
      required: ['path', 'content'],
    },
  },
  {
    category: 'builtin',
    name: 'terminal_command',
    description: 'Execute a shell command in the local workspace with timeout controls.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string' },
        cwd: { type: 'string' },
        timeout_ms: { type: 'number', default: 60000 },
      },
      required: ['command'],
    },
  },
  {
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
  {
    category: 'builtin',
    name: 'web_search',
    description: 'Search the web and return concise result snippets.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        limit: { type: 'number', default: 5 },
      },
      required: ['query'],
    },
  },
  {
    category: 'builtin',
    name: 'file_read',
    description: 'Legacy alias for read_file.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
      },
      required: ['path'],
    },
  },
  {
    category: 'builtin',
    name: 'file_write',
    description: 'Legacy alias for write_file.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        content: { type: 'string' },
        append: { type: 'boolean', default: false },
      },
      required: ['path', 'content'],
    },
  },
  {
    category: 'builtin',
    name: 'shell_exec',
    description: 'Legacy alias for terminal_command.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string' },
        cwd: { type: 'string' },
        timeout_ms: { type: 'number', default: 60000 },
      },
      required: ['command'],
    },
  },
];

function resolveSafePath(workspaceRoot: string, targetPath: string): string {
  const absolute = path.resolve(workspaceRoot, targetPath);
  const normalizedWorkspace = path.resolve(workspaceRoot);
  if (!absolute.startsWith(normalizedWorkspace)) {
    throw new Error(`Path escapes workspace: ${targetPath}`);
  }
  return absolute;
}

function clampTimeout(value: unknown, fallback: number, max: number): number {
  const raw = Number(value);
  if (!Number.isFinite(raw)) {
    return fallback;
  }
  return Math.max(1_000, Math.min(max, Math.floor(raw)));
}

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

function withTimeoutSignal(timeoutMs: number): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('Request timed out')), timeoutMs);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timer),
  };
}

function mapCanonicalName(toolName: string): string {
  if (toolName === 'file_read') {
    return 'read_file';
  }
  if (toolName === 'file_write') {
    return 'write_file';
  }
  if (toolName === 'shell_exec') {
    return 'terminal_command';
  }
  return toolName;
}

async function executeReadFile(call: ToolCall, context: BuiltinToolContext): Promise<ToolExecutionResult> {
  const requestedPath = String(call.input.path ?? '').trim();
  if (!requestedPath) {
    return { ok: false, output: 'path is required' };
  }

  try {
    const filePath = resolveSafePath(context.workspaceRoot, requestedPath);
    const content = await readFile(filePath, 'utf8');
    return {
      ok: true,
      output: JSON.stringify({ path: requestedPath, content }, null, 2),
    };
  } catch (error) {
    return { ok: false, output: error instanceof Error ? error.message : 'Failed to read file.' };
  }
}

async function executeWriteFile(call: ToolCall, context: BuiltinToolContext): Promise<ToolExecutionResult> {
  const requestedPath = String(call.input.path ?? '').trim();
  if (!requestedPath) {
    return { ok: false, output: 'path is required' };
  }

  const content = String(call.input.content ?? '');
  const append = Boolean(call.input.append ?? false);

  try {
    const filePath = resolveSafePath(context.workspaceRoot, requestedPath);
    await mkdir(path.dirname(filePath), { recursive: true });

    if (append) {
      let previous = '';
      try {
        previous = await readFile(filePath, 'utf8');
      } catch {
        previous = '';
      }
      await writeFile(filePath, `${previous}${content}`, 'utf8');
    } else {
      await writeFile(filePath, content, 'utf8');
    }

    return {
      ok: true,
      output: JSON.stringify({ path: requestedPath, bytes: content.length, append }, null, 2),
    };
  } catch (error) {
    return { ok: false, output: error instanceof Error ? error.message : 'Failed to write file.' };
  }
}

async function executeTerminalCommand(call: ToolCall, context: BuiltinToolContext): Promise<ToolExecutionResult> {
  const command = String(call.input.command ?? '').trim();
  if (!command) {
    return { ok: false, output: 'command is required' };
  }

  let cwd = context.workspaceRoot;
  if (typeof call.input.cwd === 'string' && call.input.cwd.trim().length > 0) {
    try {
      cwd = resolveSafePath(context.workspaceRoot, call.input.cwd);
    } catch (error) {
      return { ok: false, output: error instanceof Error ? error.message : 'Invalid cwd.' };
    }
  }

  const timeout = clampTimeout(call.input.timeout_ms ?? call.input.timeoutMs, 60_000, 300_000);

  try {
    const { stdout, stderr } = await exec(command, {
      cwd,
      timeout,
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024,
    });

    return {
      ok: true,
      output: JSON.stringify({
        ok: true,
        stdout,
        stderr,
        output: [stdout, stderr].filter(Boolean).join('\n') || '(no output)',
      }),
    };
  } catch (error) {
    const typed = error as {
      message?: string;
      stdout?: string;
      stderr?: string;
      code?: number | string;
    };

    return {
      ok: false,
      output: JSON.stringify({
        ok: false,
        code: typed.code,
        stdout: typed.stdout ?? '',
        stderr: typed.stderr ?? '',
        error: typed.message ?? 'Command failed',
      }),
    };
  }
}

async function executeHttpRequest(call: ToolCall): Promise<ToolExecutionResult> {
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
}

async function executeWebSearch(call: ToolCall): Promise<ToolExecutionResult> {
  const query = String(call.input.query ?? '').trim();
  if (!query) {
    return { ok: false, output: 'query is required' };
  }

  const rawLimit = Number(call.input.limit ?? 5);
  const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(10, Math.floor(rawLimit))) : 5;

  const timeout = withTimeoutSignal(15_000);
  try {
    const response = await fetch(
      `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`,
      {
        signal: timeout.signal,
      },
    );

    const payload = (await response.json()) as {
      AbstractText?: string;
      AbstractURL?: string;
      Heading?: string;
      RelatedTopics?: Array<{ Text?: string; FirstURL?: string }>;
    };

    const results: Array<{ title: string; url: string; snippet: string }> = [];

    if (payload.AbstractText && payload.AbstractURL) {
      results.push({
        title: payload.Heading || 'DuckDuckGo Instant Answer',
        url: payload.AbstractURL,
        snippet: payload.AbstractText,
      });
    }

    for (const topic of payload.RelatedTopics ?? []) {
      if (!topic || typeof topic.Text !== 'string' || typeof topic.FirstURL !== 'string') {
        continue;
      }

      results.push({
        title: topic.Text.split('-')[0]?.trim() || 'Result',
        url: topic.FirstURL,
        snippet: topic.Text,
      });

      if (results.length >= limit) {
        break;
      }
    }

    if (results.length === 0) {
      results.push({
        title: `Search: ${query}`,
        url: `https://duckduckgo.com/?q=${encodeURIComponent(query)}`,
        snippet: 'No direct instant-answer snippets were returned. Open the search URL for full results.',
      });
    }

    return {
      ok: true,
      output: JSON.stringify({ query, results: results.slice(0, limit) }, null, 2),
    };
  } catch (error) {
    return {
      ok: false,
      output: error instanceof Error ? error.message : 'Web search failed.',
    };
  } finally {
    timeout.clear();
  }
}

export function getBuiltinToolDefinitions(): ToolDefinition[] {
  return BUILTIN_TOOLS;
}

export async function executeBuiltinTool(call: ToolCall, context: BuiltinToolContext): Promise<ToolExecutionResult | undefined> {
  const toolName = mapCanonicalName(call.name);

  if (toolName === 'read_file') {
    return executeReadFile(call, context);
  }
  if (toolName === 'write_file') {
    return executeWriteFile(call, context);
  }
  if (toolName === 'terminal_command') {
    return executeTerminalCommand(call, context);
  }
  if (toolName === 'http_request') {
    return executeHttpRequest(call);
  }
  if (toolName === 'web_search') {
    return executeWebSearch(call);
  }

  return undefined;
}

*/
