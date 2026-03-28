import { readdir, readFile, writeFile } from 'fs/promises';
import { randomUUID } from 'crypto';
import path from 'path';
import { ensureOpenForgeDirs, OPENFORGE_SESSIONS_DIR } from './paths.js';
import type { AgentSession, Checkpoint } from './types.js';

export async function saveSession(session: AgentSession): Promise<void> {
  await ensureOpenForgeDirs();
  const target = path.join(OPENFORGE_SESSIONS_DIR, `${session.id}.json`);
  await writeFile(target, `${JSON.stringify(session, null, 2)}\n`, 'utf8');
}

export async function loadSession(sessionId: string): Promise<AgentSession | undefined> {
  await ensureOpenForgeDirs();
  try {
    const raw = await readFile(path.join(OPENFORGE_SESSIONS_DIR, `${sessionId}.json`), 'utf8');
    return JSON.parse(raw) as AgentSession;
  } catch {
    return undefined;
  }
}

export async function listSessions(): Promise<AgentSession[]> {
  await ensureOpenForgeDirs();
  const files = await readdir(OPENFORGE_SESSIONS_DIR, { withFileTypes: true });
  const sessions: AgentSession[] = [];

  for (const entry of files) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) {
      continue;
    }
    const raw = await readFile(path.join(OPENFORGE_SESSIONS_DIR, entry.name), 'utf8');
    sessions.push(JSON.parse(raw) as AgentSession);
  }

  return sessions.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export function checkpointSession(session: AgentSession): AgentSession {
  const checkpoint: Checkpoint = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    messageCount: session.messages.length,
    status: session.status,
  };

  return {
    ...session,
    checkpoints: [...session.checkpoints, checkpoint],
    updatedAt: checkpoint.createdAt,
  };
}
