import { mkdir, readFile, writeFile } from 'fs/promises';
import { homedir } from 'os';
import path from 'path';

export const OMNIFORGE_HOME = path.join(homedir(), '.omniforge');
export const OMNIFORGE_SKILLS_DIR = path.join(OMNIFORGE_HOME, 'skills');
export const OMNIFORGE_CONFIG_FILE = path.join(OMNIFORGE_HOME, 'config.json');
export const OMNIFORGE_PARAMS_FILE = path.join(OMNIFORGE_HOME, 'params.json');
export const OMNIFORGE_AGENTS_DIR = path.join(OMNIFORGE_HOME, 'agents');
export const OMNIFORGE_SCHEDULED_TASKS_FILE = path.join(OMNIFORGE_HOME, 'scheduled-tasks.json');

/**
 * Convert an agent name to a filesystem-safe slug.
 * Examples: "My Agent" -> "my-agent", "Trading Bot (v2)" -> "trading-bot-v2"
 */
export function slugifyAgentName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '') // Remove special characters except hyphens
    .replace(/[\s_]+/g, '-') // Replace spaces and underscores with hyphens
    .replace(/-+/g, '-') // Collapse multiple hyphens
    .replace(/^-+|-+$/g, ''); // Remove leading/trailing hyphens
}

export function getAgentDir(agentName: string): string {
  // Use agent name as folder, slugified for filesystem safety
  const folderName = slugifyAgentName(agentName);
  return path.join(OMNIFORGE_AGENTS_DIR, folderName);
}

export function getAgentStateFile(agentName: string): string {
  return path.join(getAgentDir(agentName), 'agent.json');
}

export function getAgentSystemPromptFile(agentName: string): string {
  return path.join(getAgentDir(agentName), 'system-prompt.md');
}

export function getAgentDataDir(agentName: string): string {
  return path.join(getAgentDir(agentName), 'data');
}

export async function ensureOmniForgeDirs(): Promise<void> {
  await Promise.all([
    mkdir(OMNIFORGE_HOME, { recursive: true }),
    mkdir(OMNIFORGE_SKILLS_DIR, { recursive: true }),
    mkdir(OMNIFORGE_AGENTS_DIR, { recursive: true }),
  ]);
}

export async function ensureAgentDataDir(agentName: string): Promise<string> {
  const dir = getAgentDataDir(agentName);
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
