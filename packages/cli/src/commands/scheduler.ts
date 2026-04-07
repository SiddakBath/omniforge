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
  markAgentScheduledRunCompleted,
  runAgentTurn,
  saveAgent,
  type Agent,
} from '../core/index.js';
import { displayBanner } from '../utils/banner.js';

const CHECK_INTERVAL_MS = 30_000;

export async function runSchedulerCommand(): Promise<void> {
  console.clear?.();
  displayBanner();

  const localTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  console.log('Scheduler started.');
  console.log(`Local timezone: ${localTimezone}`);
  console.log(`Polling every ${Math.floor(CHECK_INTERVAL_MS / 1000)} seconds. Press Ctrl+C to stop.\n`);

  while (true) {
    const now = new Date();
    const agents = await listAgents();
    const dueAgents = agents.filter((agent) => isAgentScheduleDue(agent, now));

    if (dueAgents.length === 0) {
      await sleep(CHECK_INTERVAL_MS);
      continue;
    }

    for (const due of dueAgents) {
      await runScheduledAgent(due);
    }

    await sleep(1_000);
  }
}

async function runScheduledAgent(agentSnapshot: Agent): Promise<void> {
  const agent = (await loadAgent(agentSnapshot.id)) ?? agentSnapshot;
  const schedule = agent.schedule;
  if (!schedule?.enabled) {
    return;
  }

  console.log(`\n⏰ Running scheduled agent: ${agent.name}`);
  console.log(`   Schedule: ${schedule.dailyTime} (${schedule.timezone})`);

  try {
    await ensureScheduledAgentDependencies(agent);

    const tools = getBuiltinToolDefinitions();
    const client = await createLLMClient(agent.provider, agent.model);
    const config = await loadConfig();
    const webSearchStatus = getWebSearchStatus(config);
    const agentDataDir = await ensureAgentDataDir(agent.id);

    if (!webSearchStatus.available) {
      console.log('   ℹ️ Web search unavailable; continuing without external web search.');
      console.log('      Configure with: omniforge config');
    }

    const executor = new DefaultToolExecutor(agentDataDir, {
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
      ...(schedule.prompt?.trim() ? { userInput: schedule.prompt.trim() } : {}),
      client,
      toolExecutor: executor,
      tools,
      onTextDelta: (delta) => {
        process.stdout.write(delta);
      },
    });
    process.stdout.write('\n');

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

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
