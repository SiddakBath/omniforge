import { ensureOmniForgeDirs, OMNIFORGE_CONFIG_FILE, readJsonFile, writeJsonFile } from './paths.js';
import type { OmniForgeConfig } from './types.js';

const DEFAULT_CONFIG: OmniForgeConfig = {
  generator: {
    provider: '',
    model: '',
  },
  providers: {},
  webSearch: {
    enabled: false,
    provider: '',
    providers: {},
  },
};

function normalizeConfig(raw: OmniForgeConfig): OmniForgeConfig {
  const webSearchRaw = raw.webSearch;
  const provider = typeof webSearchRaw?.provider === 'string' ? webSearchRaw.provider : '';
  const providerEntries = webSearchRaw?.providers ?? {};
  const providers = Object.fromEntries(
    Object.entries(providerEntries)
      .filter(([, value]) => Boolean(value?.apiKey?.trim()))
      .map(([key, value]) => [key, { apiKey: value!.apiKey.trim() }]),
  ) as OmniForgeConfig['webSearch']['providers'];

  return {
    ...raw,
    generator: {
      provider: raw.generator?.provider ?? '',
      model: raw.generator?.model ?? '',
    },
    providers: raw.providers ?? {},
    webSearch: {
      enabled: Boolean(webSearchRaw?.enabled),
      provider,
      providers,
    },
  };
}

export async function loadConfig(): Promise<OmniForgeConfig> {
  await ensureOmniForgeDirs();
  const loaded = await readJsonFile<OmniForgeConfig>(OMNIFORGE_CONFIG_FILE, DEFAULT_CONFIG);
  return normalizeConfig(loaded);
}

export async function saveConfig(config: OmniForgeConfig): Promise<void> {
  await ensureOmniForgeDirs();
  await writeJsonFile(OMNIFORGE_CONFIG_FILE, config);
}

export async function isOnboarded(): Promise<boolean> {
  const config = await loadConfig();
  return Boolean(config.generator.provider && config.generator.model);
}

export function getWebSearchStatus(config: OmniForgeConfig): {
  available: boolean;
  provider?: string;
  reason?: string;
} {
  if (!config.webSearch.enabled) {
    return {
      available: false,
      reason: 'Web search is disabled in config.',
    };
  }

  const provider = config.webSearch.provider;
  if (!provider) {
    return {
      available: false,
      reason: 'Web search provider is not configured.',
    };
  }

  const configuredKey = config.webSearch.providers[provider]?.apiKey?.trim();
  if (!configuredKey) {
    return {
      available: false,
      provider,
      reason: `No API key is saved for web search provider ${provider}.`,
    };
  }

  return {
    available: true,
    provider,
  };
}
