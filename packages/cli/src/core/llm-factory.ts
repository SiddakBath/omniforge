import { getProviderById } from './provider-catalog.js';
import { loadConfig } from './config-store.js';
import { AnthropicClient, GeminiClient, OpenAICompatibleClient } from './llm.js';
import type { LLMClient } from './types.js';

export async function createLLMClient(providerId?: string, model?: string): Promise<LLMClient> {
  const config = await loadConfig();
  const selectedProvider = providerId ?? config.generator.provider;
  const selectedModel = model ?? config.generator.model;

  if (!selectedProvider || !selectedModel) {
    throw new Error('Generator provider/model are not configured. Run onboarding first.');
  }

  const provider = await getProviderById(selectedProvider);
  if (!provider) {
    throw new Error(`Unknown provider: ${selectedProvider}`);
  }

  const providerKey = config.providers[selectedProvider]?.apiKey?.trim();
  const apiKeyRequired = provider.requiresApiKey !== false;
  if (apiKeyRequired && !providerKey) {
    throw new Error(`Missing API key for provider ${selectedProvider}.`);
  }

  const resolvedApiKey = providerKey || 'not-required';

  if (selectedProvider === 'anthropic') {
    return new AnthropicClient(resolvedApiKey, selectedModel);
  }

  if (selectedProvider === 'gemini') {
    return new GeminiClient(resolvedApiKey, selectedModel);
  }

  return new OpenAICompatibleClient(provider, resolvedApiKey, selectedModel);
}
