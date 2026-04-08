import { readFile } from 'fs/promises';
import path from 'path';
import type { ProviderCatalogEntry } from './types.js';
import { hydrateOllamaProvider } from './ollama-provider.js';

const BUILTIN_CATALOG: ProviderCatalogEntry[] = [
  {
    id: 'anthropic',
    name: 'Anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    apiKeyEnv: 'ANTHROPIC_API_KEY',
    authHeader: 'x-api-key',
    sdk: 'native',
    models: [
      { id: 'claude-sonnet-4-5', contextWindow: 200000, tags: ['reasoning', 'coding', 'tool-use', 'long-context'] },
      { id: 'claude-opus-4-1', contextWindow: 200000, tags: ['reasoning', 'analysis', 'tool-use'] },
      { id: 'claude-haiku-4-5', contextWindow: 200000, tags: ['reasoning', 'creative', 'tool-use'] },
    ],
  },
  {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    apiKeyEnv: 'OPENAI_API_KEY',
    authHeader: 'Authorization',
    sdk: 'openai-compatible',
    models: [
      { id: 'gpt-4.1', contextWindow: 1047576, tags: ['reasoning', 'tool-use', 'multimodal'] },
      { id: 'gpt-4.1-mini', contextWindow: 1047576, tags: ['fast', 'tool-use'] },
    ],
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com',
    apiKeyEnv: 'GEMINI_API_KEY',
    authHeader: 'x-goog-api-key',
    sdk: 'native',
    models: [
      { id: 'gemini-2.5-pro', contextWindow: 1048576, tags: ['reasoning', 'tool-use', 'long-context'] },
      { id: 'gemini-2.5-flash', contextWindow: 1048576, tags: ['fast', 'tool-use', 'multimodal'] },
    ],
  },
  {
    id: 'ollama',
    name: 'Ollama (Local)',
    baseUrl: 'http://127.0.0.1:11434/v1',
    authHeader: 'Authorization',
    requiresApiKey: false,
    sdk: 'openai-compatible',
    models: [],
  },
];

/**
 * Hydrate dynamic provider models (e.g., from external APIs).
 * Currently supports Ollama provider model discovery.
 */
async function hydrateDynamicProviderModels(catalog: ProviderCatalogEntry[]): Promise<ProviderCatalogEntry[]> {
  return Promise.all(catalog.map((provider) => hydrateOllamaProvider(provider)));
}

export async function loadProviderCatalog(): Promise<ProviderCatalogEntry[]> {
  const customPath = process.env.OMNIFORGE_PROVIDER_CATALOG;
  const rootCandidate = path.resolve(process.cwd(), 'providers', 'catalog.json');

  for (const candidate of [customPath, rootCandidate]) {
    if (!candidate) {
      continue;
    }
    try {
      const raw = await readFile(candidate, 'utf8');
      const parsed = JSON.parse(raw) as ProviderCatalogEntry[];
      if (parsed.length > 0) {
        return hydrateDynamicProviderModels(parsed);
      }
    } catch {
      // fallback
    }
  }

  return hydrateDynamicProviderModels(BUILTIN_CATALOG);
}

export async function getProviderById(providerId: string): Promise<ProviderCatalogEntry | undefined> {
  const catalog = await loadProviderCatalog();
  return catalog.find((provider) => provider.id === providerId);
}
