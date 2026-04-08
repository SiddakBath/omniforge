import { randomUUID } from 'crypto';
import { computeNextDailyRunAt } from './agent-schedule.js';
import {
  OMNIFORGE_SCHEDULED_TASKS_FILE,
  ensureOmniForgeDirs,
  readJsonFile,
  writeJsonFile,
} from './paths.js';

export type ScheduledTaskStatus = 'scheduled' | 'running' | 'completed' | 'failed' | 'canceled';

export type ScheduledTaskRecurrence =
  | {
      type: 'once';
    }
  | {
      type: 'daily';
      dailyTime: string;
      timezone: string;
    };

export type ScheduledTaskAction =
  | {
      kind: 'agent_run';
      agentId: string;
      prompt?: string;
    }
  | {
      kind: 'builtin_tool';
      toolName: string;
      toolInput: Record<string, unknown>;
      workspaceRoot: string;
      context?: {
        provider?: string;
        model?: string;
        currentAgentId?: string;
      };
    };

export interface ScheduledTask {
  id: string;
  label: string;
  createdAt: string;
  updatedAt: string;
  createdByAgentId?: string;
  status: ScheduledTaskStatus;
  recurrence: ScheduledTaskRecurrence;
  action: ScheduledTaskAction;
  nextRunAt?: string;
  runCount: number;
  lastRunAt?: string;
  lastResult?: {
    ok: boolean;
    output: string;
    finishedAt: string;
  };
  canceledAt?: string;
}

interface ScheduledTasksFile {
  tasks: ScheduledTask[];
}

export async function createScheduledTask(input: {
  label: string;
  createdByAgentId?: string;
  recurrence: ScheduledTaskRecurrence;
  firstRunAt: string;
  action: ScheduledTaskAction;
}): Promise<ScheduledTask> {
  const now = new Date().toISOString();
  const task: ScheduledTask = {
    id: randomUUID(),
    label: input.label.trim(),
    createdAt: now,
    updatedAt: now,
    ...(input.createdByAgentId ? { createdByAgentId: input.createdByAgentId } : {}),
    status: 'scheduled',
    recurrence: input.recurrence,
    action: input.action,
    nextRunAt: new Date(input.firstRunAt).toISOString(),
    runCount: 0,
  };

  const file = await loadScheduledTasksFile();
  file.tasks.push(task);
  await saveScheduledTasksFile(file);
  return task;
}

export async function listScheduledTasks(): Promise<ScheduledTask[]> {
  const file = await loadScheduledTasksFile();
  return [...file.tasks].sort((a, b) => {
    const aTime = a.nextRunAt ? Date.parse(a.nextRunAt) : Number.MAX_SAFE_INTEGER;
    const bTime = b.nextRunAt ? Date.parse(b.nextRunAt) : Number.MAX_SAFE_INTEGER;
    if (aTime !== bTime) {
      return aTime - bTime;
    }
    return a.createdAt < b.createdAt ? -1 : 1;
  });
}

export async function getScheduledTask(taskId: string): Promise<ScheduledTask | undefined> {
  const file = await loadScheduledTasksFile();
  return file.tasks.find((task) => task.id === taskId);
}

export async function cancelScheduledTask(taskId: string, canceledAt = new Date()): Promise<ScheduledTask | undefined> {
  const file = await loadScheduledTasksFile();
  const task = file.tasks.find((entry) => entry.id === taskId);
  if (!task) {
    return undefined;
  }

  if (task.status === 'completed' || task.status === 'failed' || task.status === 'canceled') {
    return task;
  }

  task.status = 'canceled';
  delete task.nextRunAt;
  task.canceledAt = canceledAt.toISOString();
  task.updatedAt = canceledAt.toISOString();
  await saveScheduledTasksFile(file);
  return task;
}

export async function markScheduledTaskRunning(taskId: string, now = new Date()): Promise<ScheduledTask | undefined> {
  const file = await loadScheduledTasksFile();
  const task = file.tasks.find((entry) => entry.id === taskId);
  if (!task) {
    return undefined;
  }

  const due = task.status === 'scheduled' && Boolean(task.nextRunAt) && Date.parse(task.nextRunAt!) <= now.getTime();
  if (!due) {
    return undefined;
  }

  task.status = 'running';
  task.lastRunAt = now.toISOString();
  task.updatedAt = now.toISOString();
  await saveScheduledTasksFile(file);
  return task;
}

export async function markScheduledTaskFinished(
  taskId: string,
  result: {
    ok: boolean;
    output: string;
    finishedAt?: Date;
  },
): Promise<ScheduledTask | undefined> {
  const file = await loadScheduledTasksFile();
  const task = file.tasks.find((entry) => entry.id === taskId);
  if (!task) {
    return undefined;
  }

  const finishedAt = (result.finishedAt ?? new Date()).toISOString();
  task.runCount += 1;
  task.lastResult = {
    ok: result.ok,
    output: result.output,
    finishedAt,
  };

  if (task.recurrence.type === 'daily') {
    task.status = 'scheduled';
    task.nextRunAt = computeNextDailyRunAt(
      task.recurrence.dailyTime,
      task.recurrence.timezone,
      new Date(Date.parse(finishedAt) + 1000),
    );
  } else {
    task.status = result.ok ? 'completed' : 'failed';
    delete task.nextRunAt;
  }

  task.updatedAt = finishedAt;
  await saveScheduledTasksFile(file);
  return task;
}

export async function hasActiveScheduledTasks(): Promise<boolean> {
  const file = await loadScheduledTasksFile();
  return file.tasks.some((task) => task.status === 'scheduled' || task.status === 'running');
}

async function loadScheduledTasksFile(): Promise<ScheduledTasksFile> {
  await ensureOmniForgeDirs();
  const raw = await readJsonFile<ScheduledTasksFile>(OMNIFORGE_SCHEDULED_TASKS_FILE, { tasks: [] });
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.tasks)) {
    return { tasks: [] };
  }
  return { tasks: raw.tasks };
}

async function saveScheduledTasksFile(file: ScheduledTasksFile): Promise<void> {
  await ensureOmniForgeDirs();
  await writeJsonFile(OMNIFORGE_SCHEDULED_TASKS_FILE, file);
}
