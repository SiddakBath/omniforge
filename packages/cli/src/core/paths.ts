import { mkdir, readFile, writeFile } from 'fs/promises';
import { homedir } from 'os';
import path from 'path';

export const OMNIFORGE_HOME = path.join(homedir(), '.omniforge');
export const OMNIFORGE_SKILLS_DIR = path.join(OMNIFORGE_HOME, 'skills');
export const OMNIFORGE_CONFIG_FILE = path.join(OMNIFORGE_HOME, 'config.json');
export const OMNIFORGE_PARAMS_FILE = path.join(OMNIFORGE_HOME, 'params.json');
export const OMNIFORGE_AGENTS_DIR = path.join(OMNIFORGE_HOME, 'agents');

export function getAgentDir(agentId: string): string {
  return path.join(OMNIFORGE_AGENTS_DIR, agentId);
}

export function getAgentStateFile(agentId: string): string {
  return path.join(getAgentDir(agentId), 'agent.json');
}

export function getAgentSystemPromptFile(agentId: string): string {
  return path.join(getAgentDir(agentId), 'system-prompt.md');
}

export function getAgentDataDir(agentId: string): string {
  return path.join(getAgentDir(agentId), 'data');
}

export async function ensureOmniForgeDirs(): Promise<void> {
  await Promise.all([
    mkdir(OMNIFORGE_HOME, { recursive: true }),
    mkdir(OMNIFORGE_SKILLS_DIR, { recursive: true }),
    mkdir(OMNIFORGE_AGENTS_DIR, { recursive: true }),
  ]);
}

export async function ensureAgentDataDir(agentId: string): Promise<string> {
  const dir = getAgentDataDir(agentId);
  await mkdir(dir, { recursive: true });
  return dir;
}

export async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
