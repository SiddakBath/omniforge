import type { BuiltinToolContext, BuiltinToolSpec } from './types.js';
import { clampTimeout, withTimeoutSignal } from './utils.js';

type SearchProvider = 'brave' | 'perplexity' | 'gemini' | 'grok' | 'kimi';
type PerplexityTransport = 'search_api' | 'chat_completions';
type BraveMode = 'web' | 'llm-context';

type SearchResult = {
  title: string;
  url: string;
  snippet: string;
  siteName?: string;
  published?: string;
};

type ProviderCredentials = {
  provider: SearchProvider;
  apiKey: string;
};

type SearchExecutionParams = {
  query: string;
  count: number;
  country?: string;
  language?: string;
  searchLang?: string;
  uiLang?: string;
  freshness?: string;
  dateAfter?: string;
  dateBefore?: string;
  domainFilter?: string[];
  maxTokens?: number;
  maxTokensPerPage?: number;
  timeoutMs: number;
};

type PerplexityRuntime = {
  baseUrl: string;
  model: string;
  transport: PerplexityTransport;
};

const SUPPORTED_PROVIDERS: SearchProvider[] = ['brave', 'gemini', 'grok', 'kimi', 'perplexity'];
const BRAVE_SEARCH_ENDPOINT = 'https://api.search.brave.com/res/v1/web/search';
const BRAVE_LLM_CONTEXT_ENDPOINT = 'https://api.search.brave.com/res/v1/llm/context';

const DEFAULT_PERPLEXITY_BASE_URL = 'https://api.perplexity.ai';
const DEFAULT_OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const PERPLEXITY_SEARCH_ENDPOINT = 'https://api.perplexity.ai/search';
const DEFAULT_PERPLEXITY_MODEL = 'perplexity/sonar-pro';
const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';
const DEFAULT_GROK_MODEL = 'grok-4-1-fast';
const DEFAULT_KIMI_BASE_URL = 'https://api.moonshot.ai/v1';
const DEFAULT_KIMI_MODEL = 'moonshot-v1-128k';

const RESPONSE_CACHE = new Map<string, { expiresAt: number; value: Record<string, unknown> }>();
const CACHE_TTL_MS = 2 * 60_000;

const BRAVE_FRESHNESS_SHORTCUTS = new Set(['pd', 'pw', 'pm', 'py']);
const PERPLEXITY_RECENCY_VALUES = new Set(['day', 'week', 'month', 'year']);
const BRAVE_FRESHNESS_RANGE = /^(\d{4}-\d{2}-\d{2})to(\d{4}-\d{2}-\d{2})$/;

const FRESHNESS_TO_RECENCY: Record<string, string> = {
  pd: 'day',
  pw: 'week',
  pm: 'month',
  py: 'year',
};
const RECENCY_TO_FRESHNESS: Record<string, string> = {
  day: 'pd',
  week: 'pw',
  month: 'pm',
  year: 'py',
};

const BRAVE_SEARCH_LANG_CODES = new Set([
  'ar',
  'eu',
  'bn',
  'bg',
  'ca',
  'zh-hans',
  'zh-hant',
  'hr',
  'cs',
  'da',
  'nl',
  'en',
  'en-gb',
  'et',
  'fi',
  'fr',
  'gl',
  'de',
  'el',
  'gu',
  'he',
  'hi',
  'hu',
  'is',
  'it',
  'jp',
  'kn',
  'ko',
  'lv',
  'lt',
  'ms',
  'ml',
  'mr',
  'nb',
  'pl',
  'pt-br',
  'pt-pt',
  'pa',
  'ro',
  'ru',
  'sr',
  'sk',
  'sl',
  'es',
  'sv',
  'ta',
  'te',
  'th',
  'tr',
  'uk',
  'vi',
]);
const BRAVE_SEARCH_LANG_ALIASES: Record<string, string> = {
  ja: 'jp',
  zh: 'zh-hans',
  'zh-cn': 'zh-hans',
  'zh-hk': 'zh-hant',
  'zh-sg': 'zh-hans',
  'zh-tw': 'zh-hant',
};
const BRAVE_UI_LANG_LOCALE = /^([a-z]{2})-([a-z]{2})$/i;

function getSiteName(url: string): string | undefined {
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

function normalizeProvider(raw: unknown): SearchProvider | undefined {
  if (typeof raw !== 'string') {
    return undefined;
  }
  const value = raw.trim().toLowerCase();
  return SUPPORTED_PROVIDERS.find((provider) => provider === value);
}

function normalizeIsoDate(raw: unknown): string | undefined {
  if (typeof raw !== 'string') {
    return undefined;
  }
  const value = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return undefined;
  }
  const [yearRaw, monthRaw, dayRaw] = value.split('-');
  const year = Number.parseInt(yearRaw ?? '', 10);
  const month = Number.parseInt(monthRaw ?? '', 10);
  const day = Number.parseInt(dayRaw ?? '', 10);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day
  ) {
    return undefined;
  }
  return value;
}

function normalizeFreshness(raw: unknown): string | undefined {
  if (typeof raw !== 'string') {
    return undefined;
  }
  const value = raw.trim().toLowerCase();
  if (!value) {
    return undefined;
  }
  if (BRAVE_FRESHNESS_SHORTCUTS.has(value)) {
    return value;
  }
  return PERPLEXITY_RECENCY_VALUES.has(value) ? value : undefined;
}

function normalizeFreshnessForProvider(
  value: string | undefined,
  provider: SearchProvider,
): string | undefined {
  if (!value) {
    return undefined;
  }
  const lower = value.trim().toLowerCase();
  if (!lower) {
    return undefined;
  }

  if (BRAVE_FRESHNESS_SHORTCUTS.has(lower)) {
    return provider === 'brave' ? lower : FRESHNESS_TO_RECENCY[lower];
  }
  if (PERPLEXITY_RECENCY_VALUES.has(lower)) {
    return provider === 'perplexity' ? lower : RECENCY_TO_FRESHNESS[lower];
  }

  if (provider === 'brave') {
    const match = lower.match(BRAVE_FRESHNESS_RANGE);
    if (!match) {
      return undefined;
    }
    const [, start, end] = match;
    if (!start || !end) {
      return undefined;
    }
    if (normalizeIsoDate(start) && normalizeIsoDate(end) && start <= end) {
      return `${start}to${end}`;
    }
  }

  return undefined;
}

function normalizeBraveSearchLang(raw: string | undefined): string | undefined {
  if (!raw) {
    return undefined;
  }
  const value = raw.trim().toLowerCase();
  if (!value) {
    return undefined;
  }
  const canonical = BRAVE_SEARCH_LANG_ALIASES[value] ?? value;
  return BRAVE_SEARCH_LANG_CODES.has(canonical) ? canonical : undefined;
}

function normalizeBraveUiLang(raw: string | undefined): string | undefined {
  if (!raw) {
    return undefined;
  }
  const value = raw.trim();
  if (!value) {
    return undefined;
  }
  const match = value.match(BRAVE_UI_LANG_LOCALE);
  if (!match) {
    return undefined;
  }
  const [, language, region] = match;
  const langSafe = language ?? '';
  const regionSafe = region ?? '';
  return `${langSafe.toLowerCase()}-${regionSafe.toUpperCase()}`;
}

function normalizeBraveLanguageParams(params: {
  searchLang?: string;
  uiLang?: string;
}): { searchLang?: string; uiLang?: string; invalidField?: 'search_lang' | 'ui_lang' } {
  const rawSearchLang = params.searchLang?.trim() || undefined;
  const rawUiLang = params.uiLang?.trim() || undefined;
  let searchLangCandidate = rawSearchLang;
  let uiLangCandidate = rawUiLang;

  if (normalizeBraveUiLang(rawSearchLang) && normalizeBraveSearchLang(rawUiLang)) {
    searchLangCandidate = rawUiLang;
    uiLangCandidate = rawSearchLang;
  }

  const searchLang = normalizeBraveSearchLang(searchLangCandidate);
  if (searchLangCandidate && !searchLang) {
    return { invalidField: 'search_lang' };
  }

  const uiLang = normalizeBraveUiLang(uiLangCandidate);
  if (uiLangCandidate && !uiLang) {
    return { invalidField: 'ui_lang' };
  }

  return {
    ...(searchLang ? { searchLang } : {}),
    ...(uiLang ? { uiLang } : {}),
  };
}

function isoToPerplexityDate(iso: string): string | undefined {
  const normalized = normalizeIsoDate(iso);
  if (!normalized) {
    return undefined;
  }
  const [year, month, day] = normalized.split('-');
  const monthSafe = month ?? '01';
  const daySafe = day ?? '01';
  const yearSafe = year ?? '1970';
  return `${Number.parseInt(monthSafe, 10)}/${Number.parseInt(daySafe, 10)}/${yearSafe}`;
}

function resolvePerplexityRuntime(apiKey: string): PerplexityRuntime {
  const configuredBaseUrl = process.env.WEB_SEARCH_PERPLEXITY_BASE_URL?.trim();
  const configuredModel = process.env.WEB_SEARCH_PERPLEXITY_MODEL?.trim();
  const baseUrl = (configuredBaseUrl ||
    (apiKey.startsWith('sk-or-') ? DEFAULT_OPENROUTER_BASE_URL : DEFAULT_PERPLEXITY_BASE_URL)
  ).replace(/\/$/, '');
  const transportOverride = process.env.WEB_SEARCH_PERPLEXITY_TRANSPORT?.trim().toLowerCase();

  let transport: PerplexityTransport =
    baseUrl === DEFAULT_PERPLEXITY_BASE_URL && !configuredBaseUrl ? 'search_api' : 'chat_completions';
  if (transportOverride === 'search_api' || transportOverride === 'chat_completions') {
    transport = transportOverride;
  }

  return {
    baseUrl,
    model: configuredModel || DEFAULT_PERPLEXITY_MODEL,
    transport,
  };
}

function resolvePerplexityRequestModel(baseUrl: string, model: string): string {
  if (baseUrl !== DEFAULT_PERPLEXITY_BASE_URL) {
    return model;
  }
  return model.startsWith('perplexity/') ? model.slice('perplexity/'.length) : model;
}

function resolveBraveMode(): BraveMode {
  const mode = process.env.WEB_SEARCH_BRAVE_MODE?.trim().toLowerCase();
  return mode === 'llm-context' ? 'llm-context' : 'web';
}

function getConfiguredWebSearchKey(provider: SearchProvider, context: BuiltinToolContext): string | undefined {
  const configured = context.webSearch?.providers?.[provider]?.apiKey?.trim();
  return configured || undefined;
}

function isWebSearchConfigEnabled(context: BuiltinToolContext): boolean {
  return Boolean(context.webSearch?.enabled);
}

function getProviderKey(provider: SearchProvider, context: BuiltinToolContext): string | undefined {
  const configuredKey = getConfiguredWebSearchKey(provider, context);
  if (configuredKey) {
    return configuredKey;
  }

  if (provider === 'brave') {
    return process.env.BRAVE_API_KEY;
  }

  if (provider === 'gemini') {
    if (process.env.GEMINI_API_KEY) {
      return process.env.GEMINI_API_KEY;
    }
    if (context.provider === 'gemini' && context.apiKey) {
      return context.apiKey;
    }
    return undefined;
  }

  if (provider === 'grok') {
    if (process.env.XAI_API_KEY) {
      return process.env.XAI_API_KEY;
    }
    if (context.provider === 'xai' && context.apiKey) {
      return context.apiKey;
    }
    return undefined;
  }

  if (provider === 'kimi') {
    return process.env.KIMI_API_KEY || process.env.MOONSHOT_API_KEY;
  }

  if (process.env.PERPLEXITY_API_KEY) {
    return process.env.PERPLEXITY_API_KEY;
  }
  if (process.env.OPENROUTER_API_KEY) {
    return process.env.OPENROUTER_API_KEY;
  }
  if (context.provider === 'openrouter' && context.apiKey) {
    return context.apiKey;
  }

  return undefined;
}

function detectNativeWebSearchCapability(context: BuiltinToolContext): boolean {
  const provider = (context.provider ?? '').toLowerCase();
  const model = (context.model ?? '').toLowerCase();

  if (provider === 'gemini' || provider === 'xai') {
    return true;
  }

  return /(grok|gemini|sonar|perplexity|search)/.test(model);
}

function resolveCredentials(
  explicitProvider: SearchProvider | undefined,
  context: BuiltinToolContext,
): ProviderCredentials | undefined {
  if (explicitProvider) {
    const key = getProviderKey(explicitProvider, context);
    if (!key) {
      return undefined;
    }
    return { provider: explicitProvider, apiKey: key };
  }

  for (const provider of SUPPORTED_PROVIDERS) {
    const key = getProviderKey(provider, context);
    if (key) {
      return { provider, apiKey: key };
    }
  }

  return undefined;
}

function toIsoOrThrow(raw: unknown, field: 'date_after' | 'date_before'): string | undefined {
  if (raw === undefined || raw === null || raw === '') {
    return undefined;
  }
  const parsed = normalizeIsoDate(raw);
  if (!parsed) {
    throw new Error(`${field} must use YYYY-MM-DD format.`);
  }
  return parsed;
}

function getCacheKey(provider: SearchProvider, params: SearchExecutionParams, extra = ''): string {
  return [
    provider,
    params.query,
    params.count,
    params.country ?? '',
    params.language ?? '',
    params.searchLang ?? '',
    params.uiLang ?? '',
    params.freshness ?? '',
    params.dateAfter ?? '',
    params.dateBefore ?? '',
    (params.domainFilter ?? []).join(','),
    params.maxTokens ?? '',
    params.maxTokensPerPage ?? '',
    extra,
  ].join('|');
}

function readCache(cacheKey: string): Record<string, unknown> | undefined {
  const hit = RESPONSE_CACHE.get(cacheKey);
  if (!hit) {
    return undefined;
  }
  if (Date.now() >= hit.expiresAt) {
    RESPONSE_CACHE.delete(cacheKey);
    return undefined;
  }
  return hit.value;
}

function writeCache(cacheKey: string, value: Record<string, unknown>): void {
  RESPONSE_CACHE.set(cacheKey, {
    expiresAt: Date.now() + CACHE_TTL_MS,
    value,
  });
}

async function fetchJson(url: string, init: RequestInit, timeoutMs: number): Promise<unknown> {
  const timeout = withTimeoutSignal(timeoutMs);
  try {
    const response = await fetch(url, {
      ...init,
      signal: timeout.signal,
    });

    const text = await response.text();
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${text || response.statusText}`);
    }

    try {
      return JSON.parse(text) as unknown;
    } catch (error) {
      throw new Error('Search provider returned invalid JSON.', { cause: error });
    }
  } finally {
    timeout.clear();
  }
}

async function runBraveSearch(apiKey: string, params: SearchExecutionParams): Promise<SearchResult[]> {
  const endpoint = new URL(BRAVE_SEARCH_ENDPOINT);
  endpoint.searchParams.set('q', params.query);
  endpoint.searchParams.set('count', String(params.count));
  if (params.country) {
    endpoint.searchParams.set('country', params.country);
  }
  if (params.searchLang || params.language) {
    endpoint.searchParams.set('search_lang', params.searchLang || params.language || 'en');
  }
  if (params.uiLang) {
    endpoint.searchParams.set('ui_lang', params.uiLang);
  }
  if (params.freshness) {
    endpoint.searchParams.set('freshness', params.freshness);
  } else if (params.dateAfter || params.dateBefore) {
    endpoint.searchParams.set(
      'freshness',
      `${params.dateAfter ?? '1970-01-01'}to${params.dateBefore ?? new Date().toISOString().slice(0, 10)}`,
    );
  }

  const payload = (await fetchJson(
    endpoint.toString(),
    {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'X-Subscription-Token': apiKey,
      },
    },
    params.timeoutMs,
  )) as { web?: { results?: Array<{ title?: string; url?: string; description?: string; age?: string }> } };

  return (payload.web?.results ?? []).map((entry) => {
    const url = entry.url ?? '';
    const siteName = getSiteName(url);
    return {
      title: entry.title ?? '',
      url,
      snippet: entry.description ?? '',
      ...(siteName ? { siteName } : {}),
      ...(entry.age ? { published: entry.age } : {}),
    };
  });
}

async function runBraveLlmContextSearch(
  apiKey: string,
  params: SearchExecutionParams,
): Promise<Array<{ title: string; url: string; snippets: string[]; siteName?: string }>> {
  const endpoint = new URL(BRAVE_LLM_CONTEXT_ENDPOINT);
  endpoint.searchParams.set('q', params.query);
  if (params.country) {
    endpoint.searchParams.set('country', params.country);
  }
  if (params.searchLang || params.language) {
    endpoint.searchParams.set('search_lang', params.searchLang || params.language || 'en');
  }

  const payload = (await fetchJson(
    endpoint.toString(),
    {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'X-Subscription-Token': apiKey,
      },
    },
    params.timeoutMs,
  )) as {
    grounding?: {
      generic?: Array<{ url?: string; title?: string; snippets?: string[] }>;
    };
  };

  return (payload.grounding?.generic ?? []).map((entry) => {
    const url = entry.url ?? '';
    const siteName = getSiteName(url);
    return {
      title: entry.title ?? '',
      url,
      snippets: (entry.snippets ?? []).filter(
        (snippet): snippet is string => typeof snippet === 'string' && snippet.length > 0,
      ),
      ...(siteName ? { siteName } : {}),
    };
  });
}

async function runPerplexitySearch(
  apiKey: string,
  runtime: PerplexityRuntime,
  params: SearchExecutionParams,
): Promise<{ content: string; citations: string[] }> {
  const model = resolvePerplexityRequestModel(runtime.baseUrl, runtime.model);

  const body: Record<string, unknown> = {
    model,
    messages: [{ role: 'user', content: params.query }],
  };
  if (params.freshness) {
    body.search_recency_filter = params.freshness;
  }

  const payload = (await fetchJson(
    `${runtime.baseUrl}/chat/completions`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://localhost',
        'X-Title': 'OmniForge Web Search',
      },
      body: JSON.stringify(body),
    },
    params.timeoutMs,
  )) as {
    choices?: Array<{
      message?: {
        content?: string;
        annotations?: Array<{ url?: string; url_citation?: { url?: string } }>;
      };
    }>;
    citations?: string[];
  };

  const top = payload.citations ?? [];
  const fromAnnotations = (payload.choices?.[0]?.message?.annotations ?? [])
    .map((item) => item.url_citation?.url ?? item.url)
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0);

  return {
    content: payload.choices?.[0]?.message?.content ?? 'No response',
    citations: [...new Set([...top, ...fromAnnotations])],
  };
}

async function runPerplexitySearchApi(
  apiKey: string,
  params: SearchExecutionParams,
): Promise<SearchResult[]> {
  const body: Record<string, unknown> = {
    query: params.query,
    max_results: params.count,
  };

  if (params.country) {
    body.country = params.country;
  }
  if (params.domainFilter && params.domainFilter.length > 0) {
    body.search_domain_filter = params.domainFilter;
  }
  if (params.freshness) {
    body.search_recency_filter = params.freshness;
  }
  if (params.language) {
    body.search_language_filter = [params.language];
  }
  if (params.dateAfter) {
    body.search_after_date = isoToPerplexityDate(params.dateAfter);
  }
  if (params.dateBefore) {
    body.search_before_date = isoToPerplexityDate(params.dateBefore);
  }
  if (params.maxTokens !== undefined) {
    body.max_tokens = params.maxTokens;
  }
  if (params.maxTokensPerPage !== undefined) {
    body.max_tokens_per_page = params.maxTokensPerPage;
  }

  const payload = (await fetchJson(
    PERPLEXITY_SEARCH_ENDPOINT,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://localhost',
        'X-Title': 'OmniForge Web Search',
      },
      body: JSON.stringify(body),
    },
    params.timeoutMs,
  )) as { results?: Array<{ title?: string; url?: string; snippet?: string; date?: string }> };

  return (payload.results ?? []).map((entry) => {
    const url = entry.url ?? '';
    const siteName = getSiteName(url);
    return {
      title: entry.title ?? '',
      url,
      snippet: entry.snippet ?? '',
      ...(siteName ? { siteName } : {}),
      ...(entry.date ? { published: entry.date } : {}),
    };
  });
}

async function runGeminiSearch(
  apiKey: string,
  params: SearchExecutionParams,
): Promise<{ content: string; citations: string[] }> {
  const model = process.env.WEB_SEARCH_GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  const payload = (await fetchJson(
    endpoint,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: params.query }] }],
        tools: [{ google_search: {} }],
      }),
    },
    params.timeoutMs,
  )) as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
      groundingMetadata?: { groundingChunks?: Array<{ web?: { uri?: string } }> };
    }>;
  };

  const candidate = payload.candidates?.[0];
  const content = (candidate?.content?.parts ?? [])
    .map((part) => part.text)
    .filter((item): item is string => typeof item === 'string')
    .join('\n');

  const citations = (candidate?.groundingMetadata?.groundingChunks ?? [])
    .map((chunk) => chunk.web?.uri)
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0);

  return { content: content || 'No response', citations: [...new Set(citations)] };
}

async function runGrokSearch(
  apiKey: string,
  params: SearchExecutionParams,
): Promise<{ content: string; citations: string[] }> {
  const model = process.env.WEB_SEARCH_GROK_MODEL?.trim() || DEFAULT_GROK_MODEL;

  const payload = (await fetchJson(
    'https://api.x.ai/v1/responses',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        input: [{ role: 'user', content: params.query }],
        tools: [{ type: 'web_search' }],
      }),
    },
    params.timeoutMs,
  )) as {
    output?: Array<{
      type?: string;
      content?: Array<{
        type?: string;
        text?: string;
        annotations?: Array<{ type?: string; url?: string }>;
      }>;
      text?: string;
      annotations?: Array<{ type?: string; url?: string }>;
    }>;
    output_text?: string;
    citations?: string[];
  };

  let content = payload.output_text ?? '';
  const extracted: string[] = [];

  for (const block of payload.output ?? []) {
    if (block.type === 'message') {
      for (const part of block.content ?? []) {
        if (part.type === 'output_text' && part.text) {
          content = part.text;
          for (const annotation of part.annotations ?? []) {
            if (annotation.type === 'url_citation' && annotation.url) {
              extracted.push(annotation.url);
            }
          }
        }
      }
    }
    if (block.type === 'output_text' && block.text) {
      content = block.text;
      for (const annotation of block.annotations ?? []) {
        if (annotation.type === 'url_citation' && annotation.url) {
          extracted.push(annotation.url);
        }
      }
    }
  }

  const citations = payload.citations && payload.citations.length > 0 ? payload.citations : extracted;

  return { content: content || 'No response', citations: [...new Set(citations)] };
}

async function runKimiSearch(
  apiKey: string,
  params: SearchExecutionParams,
): Promise<{ content: string; citations: string[] }> {
  const model = process.env.WEB_SEARCH_KIMI_MODEL?.trim() || DEFAULT_KIMI_MODEL;
  const baseUrl = (process.env.WEB_SEARCH_KIMI_BASE_URL?.trim() || DEFAULT_KIMI_BASE_URL).replace(
    /\/$/,
    '',
  );

  const messages: Array<Record<string, unknown>> = [{ role: 'user', content: params.query }];
  const citations = new Set<string>();

  for (let round = 0; round < 3; round += 1) {
    const payload = (await fetchJson(
      `${baseUrl}/chat/completions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          tools: [{ type: 'builtin_function', function: { name: '$web_search' } }],
        }),
      },
      params.timeoutMs,
    )) as {
      choices?: Array<{
        finish_reason?: string;
        message?: {
          content?: string;
          reasoning_content?: string;
          tool_calls?: Array<{ id?: string; function?: { arguments?: string } }>;
        };
      }>;
      search_results?: Array<{ url?: string; title?: string; content?: string }>;
    };

    for (const result of payload.search_results ?? []) {
      if (typeof result.url === 'string' && result.url.trim()) {
        citations.add(result.url.trim());
      }
    }

    const choice = payload.choices?.[0];
    const message = choice?.message;
    const toolCalls = message?.tool_calls ?? [];

    for (const call of toolCalls) {
      const argsRaw = call.function?.arguments;
      if (!argsRaw) {
        continue;
      }
      try {
        const parsed = JSON.parse(argsRaw) as {
          search_results?: Array<{ url?: string }>;
          url?: string;
        };
        if (typeof parsed.url === 'string' && parsed.url.trim()) {
          citations.add(parsed.url.trim());
        }
        for (const item of parsed.search_results ?? []) {
          if (typeof item.url === 'string' && item.url.trim()) {
            citations.add(item.url.trim());
          }
        }
      } catch {
        // ignore malformed tool arguments
      }
    }

    if (choice?.finish_reason !== 'tool_calls' || toolCalls.length === 0) {
      const content = message?.content?.trim() || message?.reasoning_content?.trim() || 'No response';
      return {
        content,
        citations: [...citations],
      };
    }

    messages.push({
      role: 'assistant',
      content: message?.content ?? '',
      ...(message?.reasoning_content ? { reasoning_content: message.reasoning_content } : {}),
      tool_calls: toolCalls,
    });

    const toolResult = JSON.stringify({
      search_results: (payload.search_results ?? []).map((result) => ({
        title: result.title ?? '',
        url: result.url ?? '',
        content: result.content ?? '',
      })),
    });

    let pushed = false;
    for (const call of toolCalls) {
      const toolCallId = call.id?.trim();
      if (!toolCallId) {
        continue;
      }
      pushed = true;
      messages.push({
        role: 'tool',
        tool_call_id: toolCallId,
        content: toolResult,
      });
    }

    if (!pushed) {
      const content = message?.content?.trim() || message?.reasoning_content?.trim() || 'No response';
      return {
        content,
        citations: [...citations],
      };
    }
  }

  return {
    content: 'Search completed but no final answer was produced.',
    citations: [...citations],
  };
}

function normalizeDomainFilter(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) {
    return undefined;
  }
  const normalized = raw
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);

  if (normalized.length === 0) {
    return undefined;
  }

  const hasAllow = normalized.some((entry) => !entry.startsWith('-'));
  const hasDeny = normalized.some((entry) => entry.startsWith('-'));
  if (hasAllow && hasDeny) {
    throw new Error('domain_filter cannot mix allowlist and denylist values.');
  }
  if (normalized.length > 20) {
    throw new Error('domain_filter supports up to 20 entries.');
  }

  return normalized;
}

function missingKeyError(provider?: SearchProvider): string {
  if (provider) {
    return `web_search provider "${provider}" is selected, but no API key was found. Run "omniforge config" to enable web search and save a provider key, or set the matching environment variable.`;
  }
  return [
    'No web search provider API key was found.',
    'Configure web search in OmniForge config by running "omniforge config".',
    'Or set at least one of: BRAVE_API_KEY, PERPLEXITY_API_KEY, OPENROUTER_API_KEY, GEMINI_API_KEY, XAI_API_KEY, KIMI_API_KEY, MOONSHOT_API_KEY.',
    'If your active model has native web search, ask it to use native search directly instead of the web_search tool.',
  ].join(' ');
}

export const webSearchTool: BuiltinToolSpec = {
  definition: {
    category: 'builtin',
    name: 'web_search',
    description:
      'Search the web using Brave, Perplexity, Gemini, Grok, or Kimi. Supports provider-aware routing, citations, localization, and advanced filters.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query string.' },
        provider: {
          type: 'string',
          enum: SUPPORTED_PROVIDERS,
          description:
            'Optional provider override. If omitted, provider is auto-selected from available API keys.',
        },
        count: { type: 'number', minimum: 1, maximum: 10, default: 5 },
        country: { type: 'string', description: '2-letter country code for localized search.' },
        language: { type: 'string', description: 'Language code for search results.' },
        search_lang: {
          type: 'string',
          description: 'Brave-specific language code (for example: en, en-gb, zh-hans).',
        },
        ui_lang: {
          type: 'string',
          description: 'Brave-specific locale code (for example: en-US).',
        },
        freshness: {
          type: 'string',
          description: 'One of: day, week, month, year (Brave also accepts pd, pw, pm, py).',
        },
        date_after: { type: 'string', description: 'Only return results after YYYY-MM-DD.' },
        date_before: { type: 'string', description: 'Only return results before YYYY-MM-DD.' },
        domain_filter: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Perplexity-only domain filters. Use allowlist values or denylist values prefixed with -.',
        },
        max_tokens: {
          type: 'number',
          description: 'Perplexity Search API only. Total content budget across results.',
        },
        max_tokens_per_page: {
          type: 'number',
          description: 'Perplexity Search API only. Max tokens extracted per page.',
        },
        timeout_ms: { type: 'number', default: 30000 },
      },
      required: ['query'],
    },
  },
  execute: async (call, context) => {
    const query = String(call.input.query ?? '').trim();
    if (!query) {
      return { ok: false, output: 'query is required' };
    }

    const configuredProvider = isWebSearchConfigEnabled(context) ? context.webSearch?.provider : undefined;
    const selectedProvider = normalizeProvider(call.input.provider ?? configuredProvider ?? process.env.WEB_SEARCH_PROVIDER);
    const credentials = resolveCredentials(selectedProvider, context);

    if (!credentials) {
      if (!selectedProvider && detectNativeWebSearchCapability(context)) {
        return {
          ok: true,
          output: JSON.stringify(
            {
              query,
              provider: 'native',
              nativeSearchHint: true,
              message:
                'No external web search API key is configured. Your current model appears to support native web search; continue without calling web_search or configure an external provider key.',
            },
            null,
            2,
          ),
        };
      }

      return { ok: false, output: missingKeyError(selectedProvider) };
    }

    const countRaw = Number(call.input.count ?? call.input.limit ?? 5);
    const count = Number.isFinite(countRaw) ? Math.max(1, Math.min(10, Math.floor(countRaw))) : 5;
    const country =
      typeof call.input.country === 'string' ? call.input.country.trim() || undefined : undefined;
    const language =
      typeof call.input.language === 'string' ? call.input.language.trim() || undefined : undefined;
    const rawSearchLang =
      typeof call.input.search_lang === 'string' ? call.input.search_lang.trim() || undefined : undefined;
    const rawUiLang =
      typeof call.input.ui_lang === 'string' ? call.input.ui_lang.trim() || undefined : undefined;
    const timeoutMs = clampTimeout(call.input.timeout_ms ?? call.input.timeoutMs, 30_000, 120_000);

    try {
      const freshnessRaw = call.input.freshness;
      const freshness = freshnessRaw === undefined ? undefined : normalizeFreshness(freshnessRaw);
      if (freshnessRaw !== undefined && !freshness) {
        return {
          ok: false,
          output: 'freshness must be one of: day, week, month, year (Brave also accepts pd, pw, pm, py).',
        };
      }

      const resolvedFreshness = normalizeFreshnessForProvider(freshness, credentials.provider);

      const dateAfter = toIsoOrThrow(call.input.date_after, 'date_after');
      const dateBefore = toIsoOrThrow(call.input.date_before, 'date_before');
      if (dateAfter && dateBefore && dateAfter > dateBefore) {
        return { ok: false, output: 'date_after must be before date_before.' };
      }

      if (resolvedFreshness && (dateAfter || dateBefore)) {
        return {
          ok: false,
          output: 'freshness cannot be combined with date_after/date_before. Use one time-filter strategy.',
        };
      }

      const braveMode = resolveBraveMode();
      const combinedSearchLang = rawSearchLang ?? language;
      const combinedUiLang = rawUiLang;

      const normalizedBraveLang: {
        searchLang?: string;
        uiLang?: string;
        invalidField?: 'search_lang' | 'ui_lang';
      } =
        credentials.provider === 'brave'
          ? normalizeBraveLanguageParams({
              ...(combinedSearchLang ? { searchLang: combinedSearchLang } : {}),
              ...(combinedUiLang ? { uiLang: combinedUiLang } : {}),
            })
          : {
              ...(combinedSearchLang ? { searchLang: combinedSearchLang } : {}),
              ...(combinedUiLang ? { uiLang: combinedUiLang } : {}),
            };

      if (normalizedBraveLang.invalidField === 'search_lang') {
        return {
          ok: false,
          output:
            'search_lang must be a Brave-supported value like en, en-gb, zh-hans, or zh-hant.',
        };
      }
      if (normalizedBraveLang.invalidField === 'ui_lang') {
        return { ok: false, output: 'ui_lang must be a locale like en-US.' };
      }

      if (credentials.provider === 'brave' && braveMode === 'llm-context' && normalizedBraveLang.uiLang) {
        return {
          ok: false,
          output: 'ui_lang is not supported by Brave llm-context mode.',
        };
      }

      if (
        credentials.provider === 'brave' &&
        braveMode === 'llm-context' &&
        (resolvedFreshness || dateAfter || dateBefore)
      ) {
        return {
          ok: false,
          output: 'freshness/date filters are not supported by Brave llm-context mode.',
        };
      }

      const perplexityRuntime =
        credentials.provider === 'perplexity' ? resolvePerplexityRuntime(credentials.apiKey) : undefined;
      const supportsStructuredPerplexityFilters =
        credentials.provider === 'perplexity' && perplexityRuntime?.transport === 'search_api';

      if (
        country &&
        credentials.provider !== 'brave' &&
        !(credentials.provider === 'perplexity' && supportsStructuredPerplexityFilters)
      ) {
        return {
          ok: false,
          output:
            credentials.provider === 'perplexity'
              ? 'country filtering requires Perplexity Search API transport.'
              : `country filtering is not supported by provider ${credentials.provider}.`,
        };
      }

      if (
        language &&
        credentials.provider !== 'brave' &&
        !(credentials.provider === 'perplexity' && supportsStructuredPerplexityFilters)
      ) {
        return {
          ok: false,
          output:
            credentials.provider === 'perplexity'
              ? 'language filtering requires Perplexity Search API transport.'
              : `language filtering is not supported by provider ${credentials.provider}.`,
        };
      }

      if (language && credentials.provider === 'perplexity' && !/^[a-z]{2}$/i.test(language)) {
        return { ok: false, output: 'language must be a 2-letter ISO 639-1 code like en, de, or fr.' };
      }

      if (
        (dateAfter || dateBefore) &&
        credentials.provider !== 'brave' &&
        !(credentials.provider === 'perplexity' && supportsStructuredPerplexityFilters)
      ) {
        return {
          ok: false,
          output:
            credentials.provider === 'perplexity'
              ? 'date_after/date_before require Perplexity Search API transport.'
              : `date filters are not supported by provider ${credentials.provider}.`,
        };
      }

      const domainFilter = normalizeDomainFilter(call.input.domain_filter);
      if (domainFilter && !supportsStructuredPerplexityFilters) {
        return {
          ok: false,
          output:
            credentials.provider === 'perplexity'
              ? 'domain_filter requires Perplexity Search API transport.'
              : `domain_filter is not supported by provider ${credentials.provider}.`,
        };
      }

      const maxTokensRaw = Number(call.input.max_tokens);
      const maxTokensPerPageRaw = Number(call.input.max_tokens_per_page);
      const maxTokens = Number.isFinite(maxTokensRaw) ? Math.max(1, Math.floor(maxTokensRaw)) : undefined;
      const maxTokensPerPage = Number.isFinite(maxTokensPerPageRaw)
        ? Math.max(1, Math.floor(maxTokensPerPageRaw))
        : undefined;
      if ((maxTokens || maxTokensPerPage) && !supportsStructuredPerplexityFilters) {
        return {
          ok: false,
          output:
            credentials.provider === 'perplexity'
              ? 'max_tokens/max_tokens_per_page require Perplexity Search API transport.'
              : `max_tokens/max_tokens_per_page are not supported by provider ${credentials.provider}.`,
        };
      }

      const searchParams: SearchExecutionParams = {
        query,
        count,
        ...(country ? { country } : {}),
        ...(language ? { language } : {}),
        ...(normalizedBraveLang.searchLang ? { searchLang: normalizedBraveLang.searchLang } : {}),
        ...(normalizedBraveLang.uiLang ? { uiLang: normalizedBraveLang.uiLang } : {}),
        ...(resolvedFreshness ? { freshness: resolvedFreshness } : {}),
        ...(dateAfter ? { dateAfter } : {}),
        ...(dateBefore ? { dateBefore } : {}),
        ...(domainFilter ? { domainFilter } : {}),
        ...(maxTokens ? { maxTokens } : {}),
        ...(maxTokensPerPage ? { maxTokensPerPage } : {}),
        timeoutMs,
      };

      const cacheKey = getCacheKey(
        credentials.provider,
        searchParams,
        credentials.provider === 'perplexity'
          ? `${perplexityRuntime?.transport ?? ''}:${perplexityRuntime?.baseUrl ?? ''}:${perplexityRuntime?.model ?? ''}`
          : credentials.provider === 'brave'
            ? braveMode
            : '',
      );
      const cached = readCache(cacheKey);
      if (cached) {
        return {
          ok: true,
          output: JSON.stringify({ ...cached, cached: true }, null, 2),
        };
      }

      const start = Date.now();

      if (credentials.provider === 'brave') {
        if (braveMode === 'llm-context') {
          const llmContextResults = await runBraveLlmContextSearch(credentials.apiKey, searchParams);
          const payload: Record<string, unknown> = {
            query,
            provider: credentials.provider,
            mode: braveMode,
            count: llmContextResults.length,
            tookMs: Date.now() - start,
            results: llmContextResults,
          };
          writeCache(cacheKey, payload);
          return { ok: true, output: JSON.stringify(payload, null, 2) };
        }

        const results = await runBraveSearch(credentials.apiKey, searchParams);
        const payload: Record<string, unknown> = {
          query,
          provider: credentials.provider,
          mode: braveMode,
          count: results.length,
          tookMs: Date.now() - start,
          results,
        };
        writeCache(cacheKey, payload);
        return { ok: true, output: JSON.stringify(payload, null, 2) };
      }

      if (credentials.provider === 'perplexity') {
        if (!perplexityRuntime) {
          return { ok: false, output: 'Failed to resolve Perplexity runtime configuration.' };
        }

        if (perplexityRuntime.transport === 'search_api') {
          const results = await runPerplexitySearchApi(credentials.apiKey, searchParams);
          const payload: Record<string, unknown> = {
            query,
            provider: credentials.provider,
            transport: perplexityRuntime.transport,
            count: results.length,
            tookMs: Date.now() - start,
            results,
          };
          writeCache(cacheKey, payload);
          return { ok: true, output: JSON.stringify(payload, null, 2) };
        }

        const result = await runPerplexitySearch(credentials.apiKey, perplexityRuntime, searchParams);
        const payload: Record<string, unknown> = {
          query,
          provider: credentials.provider,
          transport: perplexityRuntime.transport,
          model: perplexityRuntime.model,
          tookMs: Date.now() - start,
          content: result.content,
          citations: result.citations,
        };
        writeCache(cacheKey, payload);
        return { ok: true, output: JSON.stringify(payload, null, 2) };
      }

      if (credentials.provider === 'gemini') {
        const result = await runGeminiSearch(credentials.apiKey, searchParams);
        const payload: Record<string, unknown> = {
          query,
          provider: credentials.provider,
          tookMs: Date.now() - start,
          content: result.content,
          citations: result.citations,
        };
        writeCache(cacheKey, payload);
        return { ok: true, output: JSON.stringify(payload, null, 2) };
      }

      if (credentials.provider === 'grok') {
        const result = await runGrokSearch(credentials.apiKey, searchParams);
        const payload: Record<string, unknown> = {
          query,
          provider: credentials.provider,
          tookMs: Date.now() - start,
          content: result.content,
          citations: result.citations,
        };
        writeCache(cacheKey, payload);
        return { ok: true, output: JSON.stringify(payload, null, 2) };
      }

      const result = await runKimiSearch(credentials.apiKey, searchParams);
      const payload: Record<string, unknown> = {
        query,
        provider: credentials.provider,
        tookMs: Date.now() - start,
        content: result.content,
        citations: result.citations,
      };
      writeCache(cacheKey, payload);
      return { ok: true, output: JSON.stringify(payload, null, 2) };
    } catch (error) {
      return {
        ok: false,
        output: error instanceof Error ? error.message : 'Web search failed.',
      };
    }
  },
};
