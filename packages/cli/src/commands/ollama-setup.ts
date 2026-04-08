import { confirm, input, select } from '@inquirer/prompts';
import {
  getOllamaInstallDocsUrl,
  fetchOllamaModels,
  pullOllamaModelViaApi,
  loadProviderCatalog,
  OllamaClient,
} from '../core/index.js';
import type { ProviderCatalogEntry } from '../core/index.js';

export type ProviderEntry = ProviderCatalogEntry;

async function refreshOllamaProvider(): Promise<ProviderEntry | undefined> {
  const catalog = (await loadProviderCatalog()) as ProviderEntry[];
  return catalog.find((entry) => entry.id === 'ollama');
}

async function promptPullModelFlow(baseUrl: string): Promise<void> {
  const client = new OllamaClient(baseUrl);
  
  while (true) {
    const isRunning = await client.isRunning();

    if (!isRunning) {
      console.log('\n❌ Ollama server is not running.');
      console.log('   Start Ollama and ensure it is listening on http://127.0.0.1:11434');
      console.log(`   Install: ${getOllamaInstallDocsUrl()}`);
      return;
    }

    const installedModels = await client.getModels().catch(() => []);
    if (installedModels.length > 0) {
      console.log(`\nℹ Currently installed models: ${installedModels.length}`);
      const sample = installedModels.slice(0, 3).map((model) => model.id).join(', ');
      if (sample) {
        console.log(`   e.g. ${sample}${installedModels.length > 3 ? ', ...' : ''}`);
      }
    }

    const selected = await select({
      message: 'Choose a model to download',
      choices: [
        {
          name: 'Enter model tag',
          value: '__custom__',
          description: 'Example: llama3.1:8b, qwen3:8b, mistral:7b',
        },
        {
          name: 'Refresh status',
          value: '__refresh__',
          description: 'Re-check local Ollama server and installed models',
        },
        {
          name: '← Back',
          value: '__back__',
          description: 'Return without downloading',
        },
      ],
      pageSize: 12,
    });

    if (selected === '__back__') {
      return;
    }

    if (selected === '__refresh__') {
      console.log('\nRefreshing status...');
      continue;
    }

    const modelName =
      await input({
        message: 'Enter model tag (example: llama3.1:8b)',
        validate: (value) => (value.trim().length > 0 ? true : 'Model name is required.'),
      });

    console.log(`\nPulling model ${modelName.trim()}...`);
    console.log('Using Ollama HTTP API (/api/pull).\n');
    const pulled = await client.pullModel(modelName.trim());

    if (!pulled.ok) {
      console.log('\n❌ Model download failed.');
      const reason = pulled.stderr || pulled.stdout;
      if (reason) {
        console.log(`   Reason: ${reason.split(/\r?\n/)[0]}`);
      }

      const retry = await confirm({
        message: 'Try downloading a model again?',
        default: true,
      });
      if (retry) {
        continue;
      }
      return;
    }

    console.log(`\n✅ Model downloaded: ${modelName.trim()}`);
    return;
  }
}

function printOllamaHints(): void {
  console.log('\n💡 Add more local models any time:');
  console.log('   • Use "Download another Ollama model" in onboarding');
  console.log('   • ollama pull <model>');
  console.log('   • ollama list');
  console.log(`   • Browse models: ${getOllamaInstallDocsUrl()}`);
}

/**
 * Ensures Ollama server is reachable and at least one model exists.
 * Returns refreshed provider and whether caller should navigate back to provider selection.
 */
export async function ensureOllamaReadyInteractive(
  provider: ProviderEntry,
): Promise<{ provider: ProviderEntry; goBack: boolean }> {
  let currentProvider = provider;
  const client = new OllamaClient(provider.baseUrl);

  while (true) {
    const refreshed = await refreshOllamaProvider();
    if (refreshed) {
      currentProvider = refreshed;
    }

    if (currentProvider.models.length > 0) {
      printOllamaHints();
      return { provider: currentProvider, goBack: false };
    }

    const isRunning = await client.isRunning();
    const modelCount = isRunning ? (await client.getModels().catch(() => [])).length : 0;

    console.log('\n🦙 Ollama local runtime setup');
    console.log(`   Server reachable: ${isRunning ? 'yes' : 'no'}`);
    console.log(`   Local models: ${modelCount}`);

    const action = await select({
      message: 'Ollama needs setup before model selection',
      choices: [
        {
          name: 'Download a model now',
          value: '__pull_model__',
          description: 'Pull a model by tag using Ollama API',
        },
        {
          name: 'Refresh status',
          value: '__refresh__',
          description: 'Re-check server and local model list',
        },
        {
          name: '← Back to provider selection',
          value: '__back__',
          description: 'Choose a different provider for now',
        },
      ],
      pageSize: 12,
    });

    if (action === '__back__') {
      return { provider: currentProvider, goBack: true };
    }

    if (action === '__refresh__') {
      continue;
    }

    if (action === '__pull_model__') {
      await promptPullModelFlow(currentProvider.baseUrl);
      const refreshed = await refreshOllamaProvider();
      if (refreshed) {
        currentProvider = refreshed;
      }
      continue;
    }
  }
}

export async function pullAnotherOllamaModelInteractive(): Promise<void> {
  const provider = await refreshOllamaProvider();
  const baseUrl = provider?.baseUrl ?? 'http://127.0.0.1:11434/v1';
  await promptPullModelFlow(baseUrl);
}
