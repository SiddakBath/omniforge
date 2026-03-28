type SearchMode = 'auto' | 'api' | 'builtin';
type RetrievalProvider = 'brave' | 'perplexity' | 'duckduckgo';
type BuiltinProvider = 'gemini' | 'grok' | 'perplexity' | 'kimi';

type RuntimeContext = {
  provider?: string;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
};

type Context = {
  toolName: string;
  input: Record<string, unknown>;
  runtimeContext?: RuntimeContext;
};

type WebResultItem = {
  title: string;
  url: string;
  snippet: string;
};

type WebSearchApiPayload = {
  strategy: 'api';
  provider: RetrievalProvider;
  query: string;
  results: WebResultItem[];
};

type WebSearchBuiltinPayload = {
  strategy: 'builtin';
  provider: BuiltinProvider;
  query: string;
  content: string;
  citations: string[];
};

export async function runTool(context: Context) {
  if (context.toolName !== 'web_search') {
    throw new Error(`Unsupported tool: ${context.toolName}`);
  }

  const query = String(context.input.query ?? '').trim();
  const limit = clampLimit(context.input.limit ?? context.input.count ?? 5);
  const mode = normalizeSearchMode(context.input.mode ?? context.input.search_mode);
  const requestedProvider = normalizeOptionalString(context.input.provider)?.toLowerCase();
  const timeoutMs = clampTimeout(context.input.timeout_ms ?? context.input.timeoutMs ?? 15_000);

  if (!query) {
    throw new Error('query is required');
  }

  try {
    const apiProvider = resolveApiProvider(requestedProvider);
    if (mode !== 'builtin') {
      const apiResult = await tryApiSearch({
        query,
        limit,
        timeoutMs,
        provider: apiProvider,
        input: context.input,
      });
      if (apiResult) {
        return apiResult;
      }
      if (mode === 'api') {
        throw new Error(
          'No classic search API key available. Provide `brave_api_key` or `perplexity_api_key`, or switch mode to `builtin`.',
        );
      }
    }

    const builtInProvider = resolveBuiltInProvider({
      requestedProvider,
      runtimeProvider: context.runtimeContext?.provider,
      runtimeModel: context.runtimeContext?.model,
    });

    if (builtInProvider) {
      const builtInResult = await tryBuiltInSearch({
        provider: builtInProvider,
        query,
        limit,
        timeoutMs,
        input: context.input,
        runtimeContext: context.runtimeContext,
      });
      if (builtInResult) {
        return builtInResult;
      }
    }

    if (mode === 'builtin') {
      throw new Error(
        'Built-in model web search is unavailable for this provider/model or missing credentials. Provide provider-specific key params or select a supported provider.',
      );
    }

    return await runDuckDuckGoSearch({ query, limit, timeoutMs });
  } catch (error) {
    throw new Error(formatWebSearchError(error));
  }
}

async function tryApiSearch(params: {
  query: string;
  limit: number;
  timeoutMs: number;
  provider: RetrievalProvider | undefined;
  input: Record<string, unknown>;
}): Promise<WebSearchApiPayload | undefined> {
  const explicitProvider = params.provider;
  const preferredProviders: RetrievalProvider[] = explicitProvider ? [explicitProvider] : ['brave', 'perplexity'];

  for (const provider of preferredProviders) {
    if (provider === 'brave') {
      const braveApiKey =
        normalizeOptionalString(params.input.brave_api_key) ??
        normalizeOptionalString(params.input.api_key) ??
        normalizeOptionalString(process.env.BRAVE_API_KEY);
      if (!braveApiKey) {
        continue;
      }

      const results = await runBraveSearchApi({
        query: params.query,
        limit: params.limit,
        timeoutMs: params.timeoutMs,
        apiKey: braveApiKey,
        country: normalizeOptionalString(params.input.country),
        language: normalizeOptionalString(params.input.language),
        freshness: normalizeOptionalString(params.input.freshness),
        dateAfter: normalizeOptionalString(params.input.date_after),
        dateBefore: normalizeOptionalString(params.input.date_before),
      });

      return {
        strategy: 'api',
        provider: 'brave',
        query: params.query,
        results,
      };
    }

    const perplexityApiKey =
      normalizeOptionalString(params.input.perplexity_api_key) ??
      normalizeOptionalString(params.input.api_key) ??
      normalizeOptionalString(process.env.PERPLEXITY_API_KEY);
    if (!perplexityApiKey) {
      continue;
    }

    const results = await runPerplexitySearchApi({
      query: params.query,
      limit: params.limit,
      timeoutMs: params.timeoutMs,
      apiKey: perplexityApiKey,
      country: normalizeOptionalString(params.input.country),
      language: normalizeOptionalString(params.input.language),
      freshness: normalizeOptionalString(params.input.freshness),
      dateAfter: normalizeOptionalString(params.input.date_after),
      dateBefore: normalizeOptionalString(params.input.date_before),
      domainFilter: parseDomainFilter(params.input.domain_filter),
    });

    return {
      strategy: 'api',
      provider: 'perplexity',
      query: params.query,
      results,
    };
  }

  return undefined;
}

async function tryBuiltInSearch(params: {
  provider: BuiltinProvider;
  query: string;
  limit: number;
  timeoutMs: number;
  input: Record<string, unknown>;
  runtimeContext: RuntimeContext | undefined;
}): Promise<WebSearchBuiltinPayload | undefined> {
  if (params.provider === 'gemini') {
    const apiKey =
      normalizeOptionalString(params.input.gemini_api_key) ??
      normalizeOptionalString(params.input.api_key) ??
      (params.runtimeContext?.provider === 'gemini' ? normalizeOptionalString(params.runtimeContext.apiKey) : undefined) ??
      normalizeOptionalString(process.env.GEMINI_API_KEY);

    if (!apiKey) {
      return undefined;
    }

    const model =
      normalizeOptionalString(params.input.model) ??
      (params.runtimeContext?.provider === 'gemini' ? normalizeOptionalString(params.runtimeContext.model) : undefined) ??
      'gemini-2.5-flash';

    const result = await runGeminiBuiltInSearch({
      apiKey,
      query: params.query,
      model,
      timeoutMs: params.timeoutMs,
    });

    return {
      strategy: 'builtin',
      provider: 'gemini',
      query: params.query,
      content: result.content,
      citations: result.citations.slice(0, params.limit),
    };
  }

  if (params.provider === 'grok') {
    const apiKey =
      normalizeOptionalString(params.input.xai_api_key) ??
      normalizeOptionalString(params.input.grok_api_key) ??
      normalizeOptionalString(params.input.api_key) ??
      (params.runtimeContext?.provider === 'xai' ? normalizeOptionalString(params.runtimeContext.apiKey) : undefined) ??
      normalizeOptionalString(process.env.XAI_API_KEY);

    if (!apiKey) {
      return undefined;
    }

    const model =
      normalizeOptionalString(params.input.model) ??
      (params.runtimeContext?.provider === 'xai' ? normalizeOptionalString(params.runtimeContext.model) : undefined) ??
      'grok-3-latest';

    const result = await runGrokBuiltInSearch({
      apiKey,
      query: params.query,
      model,
      timeoutMs: params.timeoutMs,
    });

    return {
      strategy: 'builtin',
      provider: 'grok',
      query: params.query,
      content: result.content,
      citations: result.citations.slice(0, params.limit),
    };
  }

  if (params.provider === 'perplexity') {
    const apiKey =
      normalizeOptionalString(params.input.perplexity_api_key) ??
      normalizeOptionalString(params.input.api_key) ??
      (params.runtimeContext?.provider === 'perplexity' ? normalizeOptionalString(params.runtimeContext.apiKey) : undefined) ??
      normalizeOptionalString(process.env.PERPLEXITY_API_KEY) ??
      normalizeOptionalString(process.env.OPENROUTER_API_KEY);

    if (!apiKey) {
      return undefined;
    }

    const baseUrl =
      normalizeOptionalString(params.input.base_url) ??
      (params.runtimeContext?.provider === 'perplexity' ? normalizeOptionalString(params.runtimeContext.baseUrl) : undefined) ??
      normalizeOptionalString(process.env.PERPLEXITY_BASE_URL) ??
      (apiKey.startsWith('sk-or-') ? 'https://openrouter.ai/api/v1' : 'https://api.perplexity.ai');

    const model =
      normalizeOptionalString(params.input.model) ??
      (baseUrl.includes('openrouter.ai') ? 'perplexity/sonar-pro' : 'sonar-pro');

    const result = await runPerplexityBuiltInSearch({
      apiKey,
      baseUrl,
      query: params.query,
      model,
      timeoutMs: params.timeoutMs,
      freshness: normalizeOptionalString(params.input.freshness),
    });

    return {
      strategy: 'builtin',
      provider: 'perplexity',
      query: params.query,
      content: result.content,
      citations: result.citations.slice(0, params.limit),
    };
  }

  const apiKey =
    normalizeOptionalString(params.input.kimi_api_key) ??
    normalizeOptionalString(params.input.moonshot_api_key) ??
    normalizeOptionalString(params.input.api_key) ??
    normalizeOptionalString(process.env.KIMI_API_KEY) ??
    normalizeOptionalString(process.env.MOONSHOT_API_KEY);

  if (!apiKey) {
    return undefined;
  }

  const baseUrl = normalizeOptionalString(params.input.base_url) ?? 'https://api.moonshot.ai/v1';
  const model = normalizeOptionalString(params.input.model) ?? 'moonshot-v1-128k';
  const result = await runKimiBuiltInSearch({
    apiKey,
    baseUrl,
    query: params.query,
    model,
    timeoutMs: params.timeoutMs,
  });

  return {
    strategy: 'builtin',
    provider: 'kimi',
    query: params.query,
    content: result.content,
    citations: result.citations.slice(0, params.limit),
  };
}

function clampLimit(value: unknown): number {
  const raw = Number(value);
  if (!Number.isFinite(raw)) {
    return 5;
  }
  return Math.max(1, Math.min(10, Math.floor(raw)));
}

function clampTimeout(value: unknown): number {
  const raw = Number(value);
  if (!Number.isFinite(raw)) {
    return 15_000;
  }
  return Math.max(1_000, Math.min(60_000, Math.floor(raw)));
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeSearchMode(value: unknown): SearchMode {
  const normalized = normalizeOptionalString(value)?.toLowerCase();
  if (normalized === 'api') {
    return 'api';
  }
  if (normalized === 'builtin') {
    return 'builtin';
  }
  return 'auto';
}

function resolveApiProvider(value: string | undefined): RetrievalProvider | undefined {
  if (value === 'brave' || value === 'perplexity') {
    return value;
  }
  return undefined;
}

function resolveBuiltInProvider(params: {
  requestedProvider: string | undefined;
  runtimeProvider: string | undefined;
  runtimeModel: string | undefined;
}): BuiltinProvider | undefined {
  if (params.requestedProvider === 'gemini') {
    return 'gemini';
  }
  if (params.requestedProvider === 'grok' || params.requestedProvider === 'xai') {
    return 'grok';
  }
  if (params.requestedProvider === 'perplexity') {
    return 'perplexity';
  }
  if (params.requestedProvider === 'kimi' || params.requestedProvider === 'moonshot') {
    return 'kimi';
  }

  const provider = params.runtimeProvider?.toLowerCase();
  const model = params.runtimeModel?.toLowerCase() ?? '';

  if (provider === 'gemini') {
    return 'gemini';
  }
  if (provider === 'xai') {
    return 'grok';
  }
  if (provider === 'perplexity') {
    return 'perplexity';
  }
  if (provider === 'openrouter') {
    if (model.includes('gemini')) {
      return 'gemini';
    }
    if (model.includes('grok')) {
      return 'grok';
    }
    if (model.includes('perplexity') || model.includes('sonar')) {
      return 'perplexity';
    }
  }
  return undefined;
}

function parseDomainFilter(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const asStrings = value
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter((item) => item.length > 0);
    return asStrings.length > 0 ? asStrings : undefined;
  }

  if (typeof value === 'string') {
    const items = value
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    return items.length > 0 ? items : undefined;
  }

  return undefined;
}

function normalizeFreshnessForBrave(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === 'day') {
    return 'pd';
  }
  if (normalized === 'week') {
    return 'pw';
  }
  if (normalized === 'month') {
    return 'pm';
  }
  if (normalized === 'year') {
    return 'py';
  }
  if (normalized === 'pd' || normalized === 'pw' || normalized === 'pm' || normalized === 'py') {
    return normalized;
  }
  return undefined;
}

function normalizeFreshnessForPerplexity(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === 'pd') {
    return 'day';
  }
  if (normalized === 'pw') {
    return 'week';
  }
  if (normalized === 'pm') {
    return 'month';
  }
  if (normalized === 'py') {
    return 'year';
  }
  if (normalized === 'day' || normalized === 'week' || normalized === 'month' || normalized === 'year') {
    return normalized;
  }
  return undefined;
}

function toPerplexityDate(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return undefined;
  }
  const year = match[1] ?? '';
  const month = String(Number(match[2] ?? '0'));
  const day = String(Number(match[3] ?? '0'));
  return `${month}/${day}/${year}`;
}

function withTimeoutSignal(timeoutMs: number): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('Search request timed out')), timeoutMs);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timer),
  };
}

async function runBraveSearchApi(params: {
  query: string;
  limit: number;
  timeoutMs: number;
  apiKey: string;
  country: string | undefined;
  language: string | undefined;
  freshness: string | undefined;
  dateAfter: string | undefined;
  dateBefore: string | undefined;
}): Promise<WebResultItem[]> {
  const url = new URL('https://api.search.brave.com/res/v1/web/search');
  url.searchParams.set('q', params.query);
  url.searchParams.set('count', String(params.limit));

  if (params.country) {
    url.searchParams.set('country', params.country.toUpperCase());
  }
  if (params.language) {
    url.searchParams.set('search_lang', params.language.toLowerCase());
  }

  const freshness = normalizeFreshnessForBrave(params.freshness);
  if (freshness) {
    url.searchParams.set('freshness', freshness);
  } else if (params.dateAfter && params.dateBefore) {
    url.searchParams.set('freshness', `${params.dateAfter}to${params.dateBefore}`);
  }

  const timeout = withTimeoutSignal(params.timeoutMs);
  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'X-Subscription-Token': params.apiKey,
      },
      signal: timeout.signal,
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Brave Search API error (${response.status}): ${detail || response.statusText}`);
    }

    const data = (await response.json()) as {
      web?: {
        results?: Array<{
          title?: string;
          url?: string;
          description?: string;
        }>;
      };
    };

    const results = data.web?.results ?? [];
    return results
      .filter((entry) => typeof entry.url === 'string' && entry.url.trim().length > 0)
      .map((entry) => ({
        title: entry.title?.trim() ?? '',
        url: entry.url?.trim() ?? '',
        snippet: entry.description?.trim() ?? '',
      }));
  } finally {
    timeout.clear();
  }
}

async function runPerplexitySearchApi(params: {
  query: string;
  limit: number;
  timeoutMs: number;
  apiKey: string;
  country: string | undefined;
  language: string | undefined;
  freshness: string | undefined;
  dateAfter: string | undefined;
  dateBefore: string | undefined;
  domainFilter: string[] | undefined;
}): Promise<WebResultItem[]> {
  const body: Record<string, unknown> = {
    query: params.query,
    max_results: params.limit,
  };

  if (params.country) {
    body.country = params.country.toUpperCase();
  }
  if (params.language) {
    body.search_language_filter = [params.language.toLowerCase()];
  }
  const recency = normalizeFreshnessForPerplexity(params.freshness);
  if (recency) {
    body.search_recency_filter = recency;
  }
  const after = toPerplexityDate(params.dateAfter);
  if (after) {
    body.search_after_date = after;
  }
  const before = toPerplexityDate(params.dateBefore);
  if (before) {
    body.search_before_date = before;
  }
  if (params.domainFilter && params.domainFilter.length > 0) {
    body.search_domain_filter = params.domainFilter;
  }

  const timeout = withTimeoutSignal(params.timeoutMs);
  try {
    const response = await fetch('https://api.perplexity.ai/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${params.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: timeout.signal,
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Perplexity Search API error (${response.status}): ${detail || response.statusText}`);
    }

    const data = (await response.json()) as {
      results?: Array<{
        title?: string;
        url?: string;
        snippet?: string;
      }>;
    };

    return (data.results ?? [])
      .filter((entry) => typeof entry.url === 'string' && entry.url.trim().length > 0)
      .map((entry) => ({
        title: entry.title?.trim() ?? '',
        url: entry.url?.trim() ?? '',
        snippet: entry.snippet?.trim() ?? '',
      }));
  } finally {
    timeout.clear();
  }
}

async function runGeminiBuiltInSearch(params: {
  query: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
}): Promise<{ content: string; citations: string[] }> {
  const timeout = withTimeoutSignal(params.timeoutMs);
  try {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${params.model}:generateContent`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': params.apiKey,
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: params.query }] }],
        tools: [{ google_search: {} }],
      }),
      signal: timeout.signal,
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Gemini web search error (${response.status}): ${detail || response.statusText}`);
    }

    const data = (await response.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
        groundingMetadata?: {
          groundingChunks?: Array<{ web?: { uri?: string } }>;
        };
      }>;
    };

    const first = data.candidates?.[0];
    const content =
      first?.content?.parts
        ?.map((part) => part.text?.trim())
        .filter((value): value is string => Boolean(value))
        .join('\n') ??
      'No response';

    const citations =
      first?.groundingMetadata?.groundingChunks
        ?.map((chunk) => chunk.web?.uri?.trim())
        .filter((url): url is string => Boolean(url)) ?? [];

    return { content, citations: [...new Set(citations)] };
  } finally {
    timeout.clear();
  }
}

async function runGrokBuiltInSearch(params: {
  query: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
}): Promise<{ content: string; citations: string[] }> {
  const timeout = withTimeoutSignal(params.timeoutMs);
  try {
    const response = await fetch('https://api.x.ai/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.apiKey}`,
      },
      body: JSON.stringify({
        model: params.model,
        input: [{ role: 'user', content: params.query }],
        tools: [{ type: 'web_search' }],
      }),
      signal: timeout.signal,
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Grok web search error (${response.status}): ${detail || response.statusText}`);
    }

    const data = (await response.json()) as {
      output_text?: string;
      citations?: string[];
      output?: Array<{
        type?: string;
        content?: Array<{
          type?: string;
          text?: string;
          annotations?: Array<{ type?: string; url?: string }>;
        }>;
      }>;
    };

    let content = typeof data.output_text === 'string' ? data.output_text : '';
    const citations = [...(data.citations ?? [])];

    for (const output of data.output ?? []) {
      if (output.type !== 'message') {
        continue;
      }
      for (const block of output.content ?? []) {
        if (block.type === 'output_text' && typeof block.text === 'string' && !content) {
          content = block.text;
        }
        for (const annotation of block.annotations ?? []) {
          if (annotation.type === 'url_citation' && typeof annotation.url === 'string') {
            citations.push(annotation.url);
          }
        }
      }
    }

    return {
      content: content || 'No response',
      citations: [...new Set(citations.map((url) => url.trim()).filter((url) => url.length > 0))],
    };
  } finally {
    timeout.clear();
  }
}

async function runPerplexityBuiltInSearch(params: {
  query: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  freshness: string | undefined;
}): Promise<{ content: string; citations: string[] }> {
  const timeout = withTimeoutSignal(params.timeoutMs);
  try {
    const endpoint = `${params.baseUrl.replace(/\/$/, '')}/chat/completions`;
    const body: Record<string, unknown> = {
      model: params.model,
      messages: [{ role: 'user', content: params.query }],
    };
    const recency = normalizeFreshnessForPerplexity(params.freshness);
    if (recency) {
      body.search_recency_filter = recency;
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: timeout.signal,
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Perplexity web search error (${response.status}): ${detail || response.statusText}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string; annotations?: Array<{ url?: string }> } }>;
      citations?: string[];
    };

    const content = data.choices?.[0]?.message?.content ?? 'No response';
    const annotationUrls =
      data.choices?.[0]?.message?.annotations
        ?.map((annotation) => annotation.url?.trim())
        .filter((url): url is string => Boolean(url)) ?? [];

    return {
      content,
      citations: [...new Set([...(data.citations ?? []), ...annotationUrls])],
    };
  } finally {
    timeout.clear();
  }
}

async function runKimiBuiltInSearch(params: {
  query: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
}): Promise<{ content: string; citations: string[] }> {
  const timeout = withTimeoutSignal(params.timeoutMs);
  try {
    const endpoint = `${params.baseUrl.replace(/\/$/, '')}/chat/completions`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.apiKey}`,
      },
      body: JSON.stringify({
        model: params.model,
        messages: [{ role: 'user', content: params.query }],
        tools: [{ type: 'builtin_function', function: { name: '$web_search' } }],
      }),
      signal: timeout.signal,
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Kimi web search error (${response.status}): ${detail || response.statusText}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{
        message?: {
          content?: string;
          tool_calls?: Array<{ function?: { arguments?: string } }>;
        };
      }>;
      search_results?: Array<{ url?: string }>;
    };

    const content = data.choices?.[0]?.message?.content ?? 'No response';
    const citations = (data.search_results ?? [])
      .map((entry) => entry.url?.trim())
      .filter((url): url is string => Boolean(url));

    for (const toolCall of data.choices?.[0]?.message?.tool_calls ?? []) {
      const rawArgs = toolCall.function?.arguments;
      if (!rawArgs) {
        continue;
      }
      try {
        const parsed = JSON.parse(rawArgs) as { search_results?: Array<{ url?: string }>; url?: string };
        if (typeof parsed.url === 'string' && parsed.url.trim()) {
          citations.push(parsed.url.trim());
        }
        for (const item of parsed.search_results ?? []) {
          if (typeof item.url === 'string' && item.url.trim()) {
            citations.push(item.url.trim());
          }
        }
      } catch {
        // Ignore malformed provider payloads.
      }
    }

    return { content, citations: [...new Set(citations)] };
  } finally {
    timeout.clear();
  }
}

async function runDuckDuckGoSearch(params: {
  query: string;
  limit: number;
  timeoutMs: number;
}): Promise<WebSearchApiPayload> {
  const url = new URL('https://duckduckgo.com/html/');
  url.searchParams.set('q', params.query);

  const timeout = withTimeoutSignal(params.timeoutMs);
  try {
    const response = await fetch(url, {
      headers: {
        'user-agent': 'openforge/0.1 (+https://github.com/openforge/openforge)',
      },
      signal: timeout.signal,
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Fallback search failed (${response.status}): ${detail || response.statusText}`);
    }

    const html = await response.text();
    const matches = [...html.matchAll(/<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/g)].slice(
      0,
      params.limit,
    );

    const results = matches.map((match) => ({
      title: decodeHtml(match[2] ?? ''),
      url: match[1] ?? '',
      snippet: '',
    }));

    return {
      strategy: 'api',
      provider: 'duckduckgo',
      query: params.query,
      results,
    };
  } finally {
    timeout.clear();
  }
}

function formatWebSearchError(error: unknown): string {
  if (error instanceof Error) {
    const message = error.message.trim();
    if (message.length > 0) {
      return `web_search failed: ${message}`;
    }
  }
  return 'web_search failed due to an unknown error.';
}

function decodeHtml(input: string): string {
  return input
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#x27;', "'")
    .replace(/<[^>]+>/g, '');
}
