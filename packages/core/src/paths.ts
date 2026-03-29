import { mkdir, readFile, writeFile } from 'fs/promises';
import { homedir } from 'os';
import path from 'path';

export const OPENFORGE_HOME = path.join(homedir(), '.openforge');
export const OPENFORGE_SKILLS_DIR = path.join(OPENFORGE_HOME, 'skills');
export const OPENFORGE_CONFIG_FILE = path.join(OPENFORGE_HOME, 'config.json');
export const OPENFORGE_PARAMS_FILE = path.join(OPENFORGE_HOME, 'params.json');
export const OPENFORGE_SESSIONS_DIR = path.join(OPENFORGE_HOME, 'sessions');

export function getSessionDataDir(sessionId: string): string {
  return path.join(OPENFORGE_SESSIONS_DIR, `${sessionId}-data`);
}

export async function ensureOpenForgeDirs(): Promise<void> {
  await Promise.all([
    mkdir(OPENFORGE_HOME, { recursive: true }),
    mkdir(OPENFORGE_SKILLS_DIR, { recursive: true }),
    mkdir(OPENFORGE_SESSIONS_DIR, { recursive: true }),
  ]);
}

export async function ensureSessionDataDir(sessionId: string): Promise<string> {
  const dir = getSessionDataDir(sessionId);
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
