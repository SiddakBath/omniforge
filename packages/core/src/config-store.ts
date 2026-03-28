import { ensureOpenForgeDirs, OPENFORGE_CONFIG_FILE, readJsonFile, writeJsonFile } from './paths.js';
import type { OpenForgeConfig } from './types.js';

const DEFAULT_CONFIG: OpenForgeConfig = {
  generator: {
    provider: '',
    model: '',
  },
  providers: {},
};

export async function loadConfig(): Promise<OpenForgeConfig> {
  await ensureOpenForgeDirs();
  return readJsonFile<OpenForgeConfig>(OPENFORGE_CONFIG_FILE, DEFAULT_CONFIG);
}

export async function saveConfig(config: OpenForgeConfig): Promise<void> {
  await ensureOpenForgeDirs();
  await writeJsonFile(OPENFORGE_CONFIG_FILE, config);
}

export async function isOnboarded(): Promise<boolean> {
  const config = await loadConfig();
  return Boolean(config.generator.provider && config.generator.model);
}
