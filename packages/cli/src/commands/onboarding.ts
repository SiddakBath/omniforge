import { loadProviderCatalog, runOnboarding } from '@openforge/core';
import { confirm, password, select } from '@inquirer/prompts';
import { displayBanner } from '../utils/banner.js';

type ProviderEntry = {
  id: string;
  name: string;
  models: Array<{ id: string; contextWindow: number; tags: string[] }>;
};

function formatModelDescription(model: { contextWindow: number; tags: string[] }): string {
  return `${model.contextWindow.toLocaleString()} context • ${model.tags.join(', ')}`;
}

export async function runOnboardingCommand(): Promise<void> {
  displayBanner();
  console.log('Welcome to OpenForge onboarding.');
  console.log('This will configure your default provider/model and save your API key locally.\n');

  const providers = (await loadProviderCatalog()) as ProviderEntry[];
  if (providers.length === 0) {
    throw new Error('No providers found in catalog.');
  }

  let selectedProviderId = await select({
    message: 'Step 1/3 — Select provider',
    choices: providers.map((provider) => ({
      name: `${provider.name} (${provider.models.length} models)`,
      value: provider.id,
      description: `Provider ID: ${provider.id}`,
    })),
    pageSize: 10,
  });

  let selectedProvider = providers.find((provider) => provider.id === selectedProviderId);
  if (!selectedProvider) {
    throw new Error(`Provider not found: ${selectedProviderId}`);
  }

  while (true) {
    const selectedModelId = await select({
      message: `Step 2/3 — Select model for ${selectedProvider.name}`,
      choices: [
        ...selectedProvider.models.map((model) => ({
          name: model.id,
          value: model.id,
          description: formatModelDescription(model),
        })),
        {
          name: '← Back to provider selection',
          value: '__back__',
          description: 'Choose a different provider',
        },
      ],
      pageSize: 12,
    });

    if (selectedModelId === '__back__') {
      selectedProviderId = await select({
        message: 'Step 1/3 — Select provider',
        choices: providers.map((provider) => ({
          name: `${provider.name} (${provider.models.length} models)`,
          value: provider.id,
          description: `Provider ID: ${provider.id}`,
        })),
        pageSize: 10,
      });

      selectedProvider = providers.find((provider) => provider.id === selectedProviderId);
      if (!selectedProvider) {
        throw new Error(`Provider not found: ${selectedProviderId}`);
      }
      continue;
    }

    const apiKey = await password({
      message: `Step 3/3 — Enter ${selectedProvider.name} API key`,
      mask: '*',
      validate: (value) => (value.trim().length > 0 ? true : 'API key is required.'),
    });

    const shouldSave = await confirm({
      message: `Save this configuration? (${selectedProvider.name} / ${selectedModelId})`,
      default: true,
    });

    if (!shouldSave) {
      const restart = await confirm({
        message: 'Start onboarding again?',
        default: true,
      });

      if (restart) {
        selectedProviderId = await select({
          message: 'Step 1/3 — Select provider',
          choices: providers.map((provider) => ({
            name: `${provider.name} (${provider.models.length} models)`,
            value: provider.id,
            description: `Provider ID: ${provider.id}`,
          })),
          pageSize: 10,
        });
        selectedProvider = providers.find((provider) => provider.id === selectedProviderId);
        if (!selectedProvider) {
          throw new Error(`Provider not found: ${selectedProviderId}`);
        }
        continue;
      }

      console.log('\nOnboarding canceled.');
      return;
    }

    await runOnboarding({
      provider: selectedProvider.id,
      model: selectedModelId,
      apiKey,
    });

    console.log('\n✅ Onboarding complete.');
    console.log('Config saved to ~/.openforge/config.json');
    console.log('You can now run: openforge create "your request"\n');
    return;
  }
}
