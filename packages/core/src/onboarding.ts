import { loadProviderCatalog } from './provider-catalog.js';
import { loadConfig, saveConfig } from './config-store.js';
import { bootstrapOpenForge } from './bootstrap.js';

export interface OnboardingInput {
  provider: string;
  model: string;
  apiKey: string;
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
  await saveConfig(config);

  await bootstrapOpenForge();
}
