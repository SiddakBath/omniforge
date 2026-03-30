import { readFile } from 'fs/promises';
import path from 'path';
import type { ProviderCatalogEntry } from './types.js';

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
];

export async function loadProviderCatalog(): Promise<ProviderCatalogEntry[]> {
  const customPath = process.env.OPENFORGE_PROVIDER_CATALOG;
  const rootCandidate = path.resolve(process.cwd(), 'providers', 'catalog.json');

  for (const candidate of [customPath, rootCandidate]) {
    if (!candidate) {
      continue;
    }
    try {
      const raw = await readFile(candidate, 'utf8');
      const parsed = JSON.parse(raw) as ProviderCatalogEntry[];
      if (parsed.length > 0) {
        return parsed;
      }
    } catch {
      // fallback
    }
  }

  return BUILTIN_CATALOG;
}

export async function getProviderById(providerId: string): Promise<ProviderCatalogEntry | undefined> {
  const catalog = await loadProviderCatalog();
  return catalog.find((provider) => provider.id === providerId);
}
