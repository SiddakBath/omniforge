import { loadConfig, loadProviderCatalog, runOnboarding, type WebSearchProvider } from '../core/index.js';
import { confirm, password, select } from '@inquirer/prompts';
import { displayBanner } from '../utils/banner.js';
import {
  ensureOllamaReadyInteractive,
  pullAnotherOllamaModelInteractive,
  type ProviderEntry,
} from './ollama-setup.js';

function formatModelDescription(model: { contextWindow: number; tags: string[] }): string {
  return `${model.contextWindow.toLocaleString()} context • ${model.tags.join(', ')}`;
}

const WEB_SEARCH_PROVIDER_CHOICES: Array<{
  value: WebSearchProvider;
  name: string;
  description: string;
}> = [
  {
    value: 'brave',
    name: 'Brave Search',
    description: 'Uses BRAVE_API_KEY-compatible key format',
  },
  {
    value: 'perplexity',
    name: 'Perplexity',
    description: 'Uses PERPLEXITY_API_KEY or OpenRouter-compatible key',
  },
  {
    value: 'gemini',
    name: 'Google Gemini',
    description: 'Uses GEMINI_API_KEY-compatible key format',
  },
  {
    value: 'grok',
    name: 'xAI Grok',
    description: 'Uses XAI_API_KEY-compatible key format',
  },
  {
    value: 'kimi',
    name: 'Kimi (Moonshot)',
    description: 'Uses KIMI_API_KEY / MOONSHOT_API_KEY-compatible key format',
  },
];

export async function runOnboardingCommand(): Promise<void> {
  displayBanner();
  console.log('Welcome to OmniForge onboarding.');
  console.log('This will configure provider/model defaults and save API keys locally.\n');

  const existingConfig = await loadConfig();

  const selectProviderStep = async (): Promise<ProviderEntry> => {
    const providers = (await loadProviderCatalog()) as ProviderEntry[];
    if (providers.length === 0) {
      throw new Error('No providers found in catalog.');
    }

    const selectedProviderId = await select({
      message: 'Step 1/6 — Select provider',
      choices: providers.map((provider) => ({
        name: `${provider.name} (${provider.models.length} models)`,
        value: provider.id,
        description: `Provider ID: ${provider.id}`,
      })),
      pageSize: 10,
    });

    const selectedProvider = providers.find((provider) => provider.id === selectedProviderId);
    if (!selectedProvider) {
      throw new Error(`Provider not found: ${selectedProviderId}`);
    }

    return selectedProvider;
  };

  let selectedProvider = await selectProviderStep();

  while (true) {
    if (selectedProvider.id === 'ollama') {
      const ensured = await ensureOllamaReadyInteractive(selectedProvider);
      if (ensured.goBack) {
        selectedProvider = await selectProviderStep();
        continue;
      }
      selectedProvider = ensured.provider;
    }

    const selectedModelId = await select({
      message: `Step 2/6 — Select model for ${selectedProvider.name}`,
      choices: [
        ...selectedProvider.models.map((model) => ({
          name: model.id,
          value: model.id,
          description: formatModelDescription(model),
        })),
        ...(selectedProvider.id === 'ollama'
          ? [
              {
                name: '➕ Download another Ollama model',
                value: '__pull_model__',
                description: 'Run `ollama pull <model>` now and refresh this list',
              },
            ]
          : []),
        {
          name: '← Back to provider selection',
          value: '__back__',
          description: 'Choose a different provider',
        },
      ],
      pageSize: 12,
    });

    if (selectedModelId === '__back__') {
      selectedProvider = await selectProviderStep();
      continue;
    }

    if (selectedModelId === '__pull_model__') {
      await pullAnotherOllamaModelInteractive();
      const refreshedProviders = (await loadProviderCatalog()) as ProviderEntry[];
      const refreshed = refreshedProviders.find((provider) => provider.id === selectedProvider.id);
      if (refreshed) {
        selectedProvider = refreshed;
      }
      continue;
    }

    const apiKeyRequired = selectedProvider.requiresApiKey !== false;
    const apiKey = apiKeyRequired
      ? await password({
          message: `Step 3/6 — Enter ${selectedProvider.name} API key`,
          mask: '*',
          validate: (value) => (value.trim().length > 0 ? true : 'API key is required.'),
        })
      : '';

    const enableWebSearch = await confirm({
      message: 'Step 4/6 — Enable built-in web search? (recommended)',
      default: existingConfig.webSearch.enabled,
    });

    let webSearchProvider: WebSearchProvider | undefined;
    let webSearchApiKey: string | undefined;

    if (enableWebSearch) {
      webSearchProvider = await select({
        message: 'Step 5/6 — Select web search provider',
        choices: WEB_SEARCH_PROVIDER_CHOICES.map((choice) => ({
          name: choice.name,
          value: choice.value,
          description: choice.description,
        })),
        pageSize: 10,
      });

      const savedKey = existingConfig.webSearch.providers[webSearchProvider]?.apiKey;
      if (savedKey) {
        const reuseSaved = await confirm({
          message: `Use existing saved key for ${webSearchProvider}?`,
          default: true,
        });

        if (reuseSaved) {
          webSearchApiKey = savedKey;
        }
      }

      if (!webSearchApiKey) {
        webSearchApiKey = await password({
          message: `Step 6/6 — Enter ${webSearchProvider} web search API key`,
          mask: '*',
          validate: (value) => (value.trim().length > 0 ? true : 'Web search API key is required.'),
        });
      }
    }

    const webSearchSummary = enableWebSearch
      ? `${webSearchProvider ?? '(provider not set)'}`
      : 'disabled';

    const shouldSave = await confirm({
      message: `Save this configuration? (${selectedProvider.name} / ${selectedModelId}, web search: ${webSearchSummary})`,
      default: true,
    });

    if (!shouldSave) {
      const restart = await confirm({
        message: 'Start onboarding again?',
        default: true,
      });

      if (restart) {
        selectedProvider = await selectProviderStep();
        continue;
      }

      console.log('\nOnboarding canceled.');
      return;
    }

    await runOnboarding({
      provider: selectedProvider.id,
      model: selectedModelId,
      ...(apiKey ? { apiKey } : {}),
      webSearch: enableWebSearch
        ? {
            enabled: true,
            ...(webSearchProvider ? { provider: webSearchProvider } : {}),
            ...(webSearchApiKey ? { apiKey: webSearchApiKey } : {}),
          }
        : { enabled: false },
    });

    console.log('\n✅ Onboarding complete.');
    console.log('Config saved to ~/.omniforge/config.json');
    console.log('You can re-run configuration any time with: omniforge config');
    console.log('You can now run: omniforge create "your request"\n');
    return;
  }
}
