import type { ProviderCatalogEntry, ProviderModel } from './types.js';

type OllamaTagsResponse = {
  models?: Array<{
    name?: string;
    model?: string;
    details?: {
      family?: string;
      families?: string[];
      parameter_size?: string;
    };
  }>;
};

const DEFAULT_OLLAMA_CONTEXT_WINDOW = 32768;
const DEFAULT_OLLAMA_TAGS = ['local'];
const OLLAMA_FETCH_TIMEOUT_MS = 3500;

export interface CommandResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  code: number | null;
}

/**
 * OllamaClient provides a clean interface for interacting with Ollama API.
 */
export class OllamaClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = this.normalizeUrl(baseUrl);
  }

  /**
   * Check if Ollama server is running by attempting to reach /api/tags.
   */
  async isRunning(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(OLLAMA_FETCH_TIMEOUT_MS),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Fetch available models from /api/tags endpoint.
   */
  async getModels(): Promise<ProviderModel[]> {
    const response = await fetch(`${this.baseUrl}/api/tags`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(OLLAMA_FETCH_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`Failed to load Ollama models (${response.status})`);
    }

    const payload = (await response.json()) as OllamaTagsResponse;
    const models = payload.models ?? [];

    return models
      .map((model) => {
        const id = model.name ?? model.model;
        if (!id) {
          return undefined;
        }

        const rawFamilies = model.details?.families?.length
          ? model.details.families
          : model.details?.family
            ? [model.details.family]
            : [];

        const tags = [...new Set([...DEFAULT_OLLAMA_TAGS, ...rawFamilies.map((family) => family.toLowerCase())])];

        if (model.details?.parameter_size) {
          tags.push(model.details.parameter_size.toLowerCase());
        }

        return {
          id,
          contextWindow: DEFAULT_OLLAMA_CONTEXT_WINDOW,
          tags: [...new Set(tags)],
        };
      })
      .filter((model): model is NonNullable<typeof model> => Boolean(model))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  /**
   * Pull a model via /api/pull endpoint.
   */
  async pullModel(model: string): Promise<CommandResult> {
    try {
      const response = await fetch(`${this.baseUrl}/api/pull`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ name: model, stream: false }),
      });

      const raw = await response.text();
      if (!response.ok) {
        return {
          ok: false,
          stdout: '',
          stderr: raw || `HTTP ${response.status}`,
          code: response.status,
        };
      }

      return {
        ok: true,
        stdout: raw || 'Model pull completed via Ollama API.',
        stderr: '',
        code: 0,
      };
    } catch (error) {
      return {
        ok: false,
        stdout: '',
        stderr: error instanceof Error ? error.message : String(error),
        code: null,
      };
    }
  }

  /**
   * Normalize URL: strip path, query, hash.
   */
  private normalizeUrl(url: string): string {
    const parsed = new URL(url);
    parsed.pathname = '/';
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString().replace(/\/$/, '');
  }
}

/**
 * Fetch available models from Ollama /api/tags endpoint.
 * Returns a sorted list of ProviderModel entries.
 */
export async function fetchOllamaModels(baseUrl: string): Promise<ProviderModel[]> {
  const client = new OllamaClient(baseUrl);
  return client.getModels();
}

/**
 * Hydrate the Ollama provider with live models from /api/tags.
 * Returns a new provider entry with models populated, or the original with empty models on failure.
 */
export async function hydrateOllamaProvider(provider: ProviderCatalogEntry): Promise<ProviderCatalogEntry> {
  if (provider.id !== 'ollama') {
    return provider;
  }

  try {
    const models = await fetchOllamaModels(provider.baseUrl);
    return {
      ...provider,
      models,
    };
  } catch {
    return {
      ...provider,
      models: [],
    };
  }
}

export function getOllamaInstallDocsUrl(): string {
  return 'https://ollama.com/download';
}

/**
 * Pull a model via the OllamaClient API.
 */
export async function pullOllamaModelViaApi(baseUrl: string, model: string): Promise<CommandResult> {
  const client = new OllamaClient(baseUrl);
  return client.pullModel(model);
}

/**
 * Check if Ollama server is running at the given baseUrl.
 */
export async function getOllamaRuntimeStatus(baseUrl: string): Promise<boolean> {
  const client = new OllamaClient(baseUrl);
  return client.isRunning();
}
