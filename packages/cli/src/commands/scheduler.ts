import {
  createLLMClient,
  DefaultToolExecutor,
  deferAgentSchedule,
  ensureAgentDataDir,
  findMissingParams,
  findMissingSkillBins,
  getBuiltinToolDefinitions,
  getWebSearchStatus,
  isAgentScheduleDue,
  listAgents,
  listSkills,
  loadAgent,
  loadConfig,
  listScheduledTasks,
  markScheduledTaskFinished,
  markScheduledTaskRunning,
  markAgentScheduledRunCompleted,
  runAgentTurn,
  saveAgent,
  type Agent,
  type ScheduledTask as PersistedScheduledTask,
} from '../core/index.js';
import { displayBanner } from '../utils/banner.js';
import { randomUUID } from 'crypto';
import cron, { type ScheduledTask as CronScheduledTask } from 'node-cron';

const SCHEDULE_RELOAD_INTERVAL_MS = 60_000;
const TASK_POLL_INTERVAL_MS = 15_000;

const scheduledJobs = new Map<string, CronScheduledTask>();
const scheduleSignatures = new Map<string, string>();
const runningAgentIds = new Set<string>();
const runningScheduledTaskIds = new Set<string>();

export async function runSchedulerCommand(): Promise<void> {
  console.clear?.();
  displayBanner();

  const localTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  console.log('Scheduler started.');
  console.log(`Local timezone: ${localTimezone}`);
  console.log('Press Ctrl+C to stop.\n');

  try {
    await syncScheduledJobs();
    await runStartupCatchUp();
    await runPendingScheduledTasks('catch-up');
  } catch (error) {
    logSchedulerError('initializing scheduler', error);
  }

  console.log(`Active schedules: ${scheduledJobs.size}`);
  console.log(`Refreshing schedules every ${Math.floor(SCHEDULE_RELOAD_INTERVAL_MS / 1000)} seconds.\n`);

  const reloadTimer = setInterval(() => {
    void syncScheduledJobs().catch((error) => {
      logSchedulerError('refreshing schedules', error);
    });
  }, SCHEDULE_RELOAD_INTERVAL_MS);

  const taskPollTimer = setInterval(() => {
    void runPendingScheduledTasks('poll').catch((error) => {
      logSchedulerError('processing scheduled tasks', error);
    });
  }, TASK_POLL_INTERVAL_MS);

  const shutdown = () => {
    clearInterval(reloadTimer);
    clearInterval(taskPollTimer);
    for (const job of scheduledJobs.values()) {
      job.stop();
      job.destroy();
    }
    scheduledJobs.clear();
    scheduleSignatures.clear();
    runningAgentIds.clear();
    runningScheduledTaskIds.clear();

    console.log('\nScheduler stopped.');
    process.exit(0);
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  await new Promise<void>(() => {
    // Keep process alive until a shutdown signal is received.
  });
}

async function runStartupCatchUp(): Promise<void> {
  const now = new Date();
  const agents = await listAgents();
  const dueAgents = agents.filter((agent) => isAgentScheduleDue(agent, now));

  if (dueAgents.length > 0) {
    console.log(`Running ${dueAgents.length} missed scheduled run(s) from downtime...`);
    for (const due of dueAgents) {
      await runScheduledAgentById(due.id, 'catch-up');
    }
    console.log('Catch-up complete.\n');
  }
}

async function syncScheduledJobs(): Promise<void> {
  const agents = await listAgents();
  const desiredSchedules = new Map<string, string>();

  for (const agent of agents) {
    const schedule = agent.schedule;
    if (!schedule?.enabled) {
      continue;
    }

    const signature = `${schedule.dailyTime}|${schedule.timezone}`;
    desiredSchedules.set(agent.id, signature);

    const existingSignature = scheduleSignatures.get(agent.id);
    const existingJob = scheduledJobs.get(agent.id);

    if (existingSignature === signature && existingJob) {
      continue;
    }

    if (existingJob) {
      existingJob.stop();
      existingJob.destroy();
      scheduledJobs.delete(agent.id);
      scheduleSignatures.delete(agent.id);
    }

    const cronExpression = toDailyCronExpression(schedule.dailyTime);
    if (!cronExpression) {
      console.error(`Invalid daily time for ${agent.name}: ${schedule.dailyTime}. Skipping schedule.`);
      continue;
    }

    const job = cron.schedule(
      cronExpression,
      () => {
        void runScheduledAgentById(agent.id, 'cron').catch((error) => {
          logSchedulerError(`running scheduled agent ${agent.name}`, error);
        });
      },
      {
        timezone: schedule.timezone,
      },
    );

    scheduledJobs.set(agent.id, job);
    scheduleSignatures.set(agent.id, signature);
    console.log(`🗓️ Scheduled: ${agent.name} at ${schedule.dailyTime} (${schedule.timezone})`);
  }

  for (const [agentId, job] of scheduledJobs.entries()) {
    if (desiredSchedules.has(agentId)) {
      continue;
    }

    job.stop();
    job.destroy();
    scheduledJobs.delete(agentId);
    scheduleSignatures.delete(agentId);
    console.log(`🧹 Removed schedule for agent ${agentId}`);
  }
}

async function runPendingScheduledTasks(trigger: 'poll' | 'catch-up'): Promise<void> {
  const tasks = await listScheduledTasks();
  const nowMs = Date.now();
  const due = tasks.filter((task) => {
    if (task.status !== 'scheduled') {
      return false;
    }
    if (!task.nextRunAt) {
      return false;
    }
    return Date.parse(task.nextRunAt) <= nowMs;
  });

  if (due.length === 0) {
    return;
  }

  if (trigger === 'catch-up') {
    console.log(`Running ${due.length} queued scheduled task(s) from downtime...`);
  }

  for (const task of due) {
    await runScheduledTaskById(task.id, trigger);
  }

  if (trigger === 'catch-up') {
    console.log('Scheduled task catch-up complete.\n');
  }
}

async function runScheduledTaskById(taskId: string, trigger: 'poll' | 'catch-up'): Promise<void> {
  if (runningScheduledTaskIds.has(taskId)) {
    return;
  }

  runningScheduledTaskIds.add(taskId);
  try {
    const task = await markScheduledTaskRunning(taskId, new Date());
    if (!task) {
      return;
    }

    await runScheduledTask(task, trigger);
  } finally {
    runningScheduledTaskIds.delete(taskId);
  }
}

async function runScheduledTask(task: PersistedScheduledTask, trigger: 'poll' | 'catch-up'): Promise<void> {
  console.log(`\n🧭 Running scheduled task (${trigger}): ${task.label} (${task.id})`);

  try {
    const output = await executeScheduledTask(task);
    const updated = await markScheduledTaskFinished(task.id, {
      ok: true,
      output,
      finishedAt: new Date(),
    });

    console.log(`✅ Task completed: ${task.label}`);
    if (updated?.nextRunAt) {
      console.log(`   Next run: ${updated.nextRunAt}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const updated = await markScheduledTaskFinished(task.id, {
      ok: false,
      output: message,
      finishedAt: new Date(),
    });

    console.error(`❌ Scheduled task failed: ${task.label}: ${message}`);
    if (updated?.nextRunAt) {
      console.log(`   Rescheduled for: ${updated.nextRunAt}`);
    }
  }
}

async function executeScheduledTask(task: PersistedScheduledTask): Promise<string> {
  if (task.action.kind === 'agent_run') {
    return executeScheduledAgentRunTask(task);
  }
  return executeScheduledBuiltinToolTask(task);
}

async function executeScheduledAgentRunTask(task: PersistedScheduledTask): Promise<string> {
  if (task.action.kind !== 'agent_run') {
    throw new Error('Invalid task action kind for agent run task.');
  }

  const agent = await loadAgent(task.action.agentId);
  if (!agent) {
    throw new Error(`Agent not found: ${task.action.agentId}`);
  }

  await ensureScheduledAgentDependencies(agent);
  const updated = await executeAgentTurn(agent, task.action.prompt?.trim());
  await saveAgent(updated);

  return JSON.stringify(
    {
      action: 'agent_run',
      agentId: agent.id,
      agentName: agent.name,
      status: updated.status,
      messageCount: updated.messages.length,
    },
    null,
    2,
  );
}

async function executeScheduledBuiltinToolTask(task: PersistedScheduledTask): Promise<string> {
  if (task.action.kind !== 'builtin_tool') {
    throw new Error('Invalid task action kind for built-in tool task.');
  }

  const config = await loadConfig();
  const executor = new DefaultToolExecutor(task.action.workspaceRoot, {
    ...(task.action.context?.currentAgentId ? { currentAgentId: task.action.context.currentAgentId } : {}),
    ...(task.action.context?.provider ? { provider: task.action.context.provider } : {}),
    ...(task.action.context?.model ? { model: task.action.context.model } : {}),
    webSearch: {
      enabled: config.webSearch.enabled,
      ...(config.webSearch.provider ? { provider: config.webSearch.provider } : {}),
      providers: Object.fromEntries(
        Object.entries(config.webSearch.providers)
          .filter(([, value]) => Boolean(value?.apiKey?.trim()))
          .map(([providerId, value]) => [providerId, { apiKey: value!.apiKey.trim() }]),
      ),
    },
  });

  const result = await executor.execute({
    id: randomUUID(),
    name: task.action.toolName,
    input: task.action.toolInput,
  });

  if (!result.ok) {
    throw new Error(result.output);
  }

  return result.output;
}

function toDailyCronExpression(dailyTime: string): string | undefined {
  const match = /^(?<hour>[01]\d|2[0-3]):(?<minute>[0-5]\d)$/.exec(dailyTime);
  if (!match?.groups) {
    return undefined;
  }

  return `${match.groups.minute} ${match.groups.hour} * * *`;
}

async function runScheduledAgentById(agentId: string, trigger: 'cron' | 'catch-up'): Promise<void> {
  if (runningAgentIds.has(agentId)) {
    return;
  }

  runningAgentIds.add(agentId);
  try {
    const agent = await loadAgent(agentId);
    if (!agent?.schedule?.enabled) {
      return;
    }

    if (!isAgentScheduleDue(agent, new Date())) {
      return;
    }

    await runScheduledAgent(agent, trigger);
  } finally {
    runningAgentIds.delete(agentId);
  }
}

async function runScheduledAgent(agent: Agent, trigger: 'cron' | 'catch-up'): Promise<void> {
  const schedule = agent.schedule;
  if (!schedule?.enabled) {
    return;
  }

  console.log(`\n⏰ Running scheduled agent (${trigger}): ${agent.name}`);
  console.log(`   Schedule: ${schedule.dailyTime} (${schedule.timezone})`);

  try {
    await ensureScheduledAgentDependencies(agent);
    const updated = await executeAgentTurn(agent, schedule.prompt?.trim());

    const scheduled = markAgentScheduledRunCompleted(updated, new Date());
    await saveAgent(scheduled);

    console.log(`✅ Completed: ${agent.name}`);
    if (scheduled.schedule?.nextRunAt) {
      console.log(`   Next run: ${scheduled.schedule.nextRunAt}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`❌ Scheduled run failed for ${agent.name}: ${message}`);

    const deferred = deferAgentSchedule(agent, new Date());
    await saveAgent(deferred);

    if (deferred.schedule?.nextRunAt) {
      console.log(`   Deferred to next run: ${deferred.schedule.nextRunAt}`);
    }
  }
}

async function executeAgentTurn(agent: Agent, userInput?: string): Promise<Agent> {
  const tools = getBuiltinToolDefinitions();
  const client = await createLLMClient(agent.provider, agent.model);
  const config = await loadConfig();
  const webSearchStatus = getWebSearchStatus(config);
  const agentDataDir = await ensureAgentDataDir(agent.name);

  if (!webSearchStatus.available) {
    console.log('   ℹ️ Web search unavailable; continuing without external web search.');
    console.log('      Configure with: omniforge config');
  }

  const executor = new DefaultToolExecutor(agentDataDir, {
    currentAgentId: agent.id,
    provider: agent.provider,
    model: agent.model,
    apiKey: config.providers[agent.provider]?.apiKey,
    webSearch: {
      enabled: config.webSearch.enabled,
      ...(config.webSearch.provider ? { provider: config.webSearch.provider } : {}),
      providers: Object.fromEntries(
        Object.entries(config.webSearch.providers)
          .filter(([, value]) => Boolean(value?.apiKey?.trim()))
          .map(([providerId, value]) => [providerId, { apiKey: value!.apiKey.trim() }]),
      ),
    },
  });

  const updated = await runAgentTurn({
    agent,
    ...(userInput?.trim() ? { userInput: userInput.trim() } : {}),
    client,
    toolExecutor: executor,
    tools,
    onTextDelta: (delta) => {
      process.stdout.write(delta);
    },
  });
  process.stdout.write('\n');

  return updated;
}

async function ensureScheduledAgentDependencies(agent: Agent): Promise<void> {
  const assignedSkills = await listSkills();
  const activeSkills = assignedSkills.filter((skill) => agent.skills.includes(skill.id));
  const requiredParams = activeSkills.flatMap((skill) => skill.requiredParams);
  const missingParams = await findMissingParams(requiredParams);
  const missingBins = await findMissingSkillBins(activeSkills);

  if (missingBins.length > 0) {
    const list = missingBins.map((item) => `${item.bin} (required by ${item.skillId})`).join(', ');
    throw new Error(`Missing required binaries: ${list}`);
  }

  if (missingParams.length > 0) {
    const missing = missingParams.map((param: { label: string; key: string }) => `${param.label} (${param.key})`).join(', ');
    throw new Error(`Missing required parameters: ${missing}`);
  }
}

function logSchedulerError(action: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`❌ Scheduler error while ${action}: ${message}`);
}
