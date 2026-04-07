import { loadProviderCatalog } from './provider-catalog.js';
import { loadConfig, saveConfig } from './config-store.js';
import { bootstrapOmniForge } from './bootstrap.js';
import type { WebSearchProvider } from './types.js';

export interface OnboardingInput {
  provider: string;
  model: string;
  apiKey: string;
  webSearch?: {
    enabled: boolean;
    provider?: WebSearchProvider;
    apiKey?: string;
  };
}

export async function runOnboarding(input: OnboardingInput): Promise<void> {
  const catalog = await loadProviderCatalog();
  const provider = catalog.find((entry) => entry.id === input.provider);

  if (!provider) {
    throw new Error(`Provider not found: ${input.provider}`);
  }

  const model = provider.models.find((item) => item.id === input.model);
  if (!model) {
    throw new Error(`Model not found for provider ${provider.name}: ${input.model}`);
  }

  const config = await loadConfig();
  config.generator.provider = input.provider;
  config.generator.model = input.model;
  config.providers[input.provider] = { apiKey: input.apiKey };

  if (input.webSearch) {
    config.webSearch.enabled = input.webSearch.enabled;
    if (input.webSearch.enabled) {
      const providerId = input.webSearch.provider;
      const webSearchKey = input.webSearch.apiKey?.trim();
      if (providerId && webSearchKey) {
        config.webSearch.provider = providerId;
        config.webSearch.providers[providerId] = { apiKey: webSearchKey };
      }
    }
  }

  await saveConfig(config);

  await bootstrapOmniForge();
}
