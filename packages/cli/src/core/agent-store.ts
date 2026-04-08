import { mkdir, readdir, readFile, writeFile } from 'fs/promises';
import { randomUUID } from 'crypto';
import path from 'path';
import {
  ensureOmniForgeDirs,
  getAgentDir,
  getAgentStateFile,
  getAgentSystemPromptFile,
  OMNIFORGE_AGENTS_DIR,
} from './paths.js';
import type { Agent, Checkpoint } from './types.js';

export async function saveAgent(agent: Agent): Promise<void> {
  await ensureOmniForgeDirs();
  await mkdir(getAgentDir(agent.name), { recursive: true });
  const target = getAgentStateFile(agent.name);
  await writeFile(target, `${JSON.stringify(agent, null, 2)}\n`, 'utf8');
}

export async function loadAgent(agentId: string): Promise<Agent | undefined> {
  await ensureOmniForgeDirs();
  try {
    // Search all agent directories to find the agent by ID
    const agentEntries = await readdir(OMNIFORGE_AGENTS_DIR, { withFileTypes: true });
    for (const entry of agentEntries) {
      if (!entry.isDirectory()) {
        continue;
      }
      try {
        const stateFile = path.join(OMNIFORGE_AGENTS_DIR, entry.name, 'agent.json');
        const raw = await readFile(stateFile, 'utf8');
        const agent = JSON.parse(raw) as Agent;
        if (agent.id === agentId) {
          return agent;
        }
      } catch {
        // Continue to next directory
      }
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export async function listAgents(): Promise<Agent[]> {
  await ensureOmniForgeDirs();
  const agents: Agent[] = [];

  const agentEntries = await readdir(OMNIFORGE_AGENTS_DIR, { withFileTypes: true });
  for (const entry of agentEntries) {
    if (!entry.isDirectory()) {
      continue;
    }
    try {
      const raw = await readFile(path.join(OMNIFORGE_AGENTS_DIR, entry.name, 'agent.json'), 'utf8');
      const agent = JSON.parse(raw) as Agent;
      agents.push(agent);
    } catch {
      // Ignore malformed or partial entries.
    }
  }

  return agents.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export async function saveAgentSystemPrompt(agentName: string, systemPrompt: string): Promise<void> {
  await ensureOmniForgeDirs();
  await mkdir(getAgentDir(agentName), { recursive: true });
  await writeFile(getAgentSystemPromptFile(agentName), systemPrompt, 'utf8');
}

export async function loadAgentSystemPrompt(agentName: string): Promise<string> {
  await ensureOmniForgeDirs();
  return readFile(getAgentSystemPromptFile(agentName), 'utf8');
}

export function checkpointAgent(agent: Agent): Agent {
  const checkpoint: Checkpoint = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    messageCount: agent.messages.length,
    status: agent.status,
  };

  return {
    ...agent,
    checkpoints: [...agent.checkpoints, checkpoint],
    updatedAt: checkpoint.createdAt,
  };
}
