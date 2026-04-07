import {
  type Agent,
  clearAgentSchedule,
  createLLMClient,
  DefaultToolExecutor,
  isValidDailyTime,
  isValidIanaTimeZone,
  setAgentDailySchedule,
  findMissingSkillBins,
  listAgents,
  listSkills,
  loadConfig,
  loadAgent,
  runAgentTurn,
  findMissingParams,
  getWebSearchStatus,
  getBuiltinToolDefinitions,
  saveAgent,
  saveParamValue,
  ensureAgentDataDir,
} from '../core/index.js';
import { selectFromList, promptInput, promptPassword, promptConfirm, printInfo, printSuccess } from '../utils/interactive.js';
import { displayBanner } from '../utils/banner.js';

const EXIT_INPUTS = new Set(['/exit', 'exit', '/quit', 'quit']);

async function ensureAgentDependencies(agent: Agent): Promise<void> {
  const assignedSkills = await listSkills();
  const activeSkills = assignedSkills.filter((skill) => agent.skills.includes(skill.id));
  const requiredParams = activeSkills.flatMap((skill) => skill.requiredParams);
  const missingParams = await findMissingParams(requiredParams);
  const missingBins = await findMissingSkillBins(activeSkills);

  if (missingBins.length > 0) {
    const list = missingBins.map((item) => `${item.bin} (required by ${item.skillId})`).join(', ');
    throw new Error(`Cannot run agent: missing required binaries: ${list}`);
  }

  if (missingParams.length === 0) {
    return;
  }

  console.log('\n⚙️  Agent requires additional parameters before running:');
  missingParams.forEach((param: any) => {
    console.log(`  • ${param.label}${param.description ? ` - ${param.description}` : ''}`);
    const skillsNeedingIt = activeSkills
      .filter((s: any) => s.requiredParams.some((rp: any) => rp.key === param.key))
      .map((s: any) => s.id);
    if (skillsNeedingIt.length > 0) {
      console.log(`    Required by: ${skillsNeedingIt.join(', ')}`);
    }
  });
  console.log('');

  for (const param of missingParams) {
    const value = param.secret ? await promptPassword(`🔐 ${param.label}`) : await promptInput(`📌 ${param.label}`);
    if (!value.trim()) {
      throw new Error(`${param.label} is required to continue.`);
    }
    await saveParamValue(param, value);
  }

  const remaining = await findMissingParams(requiredParams);
  if (remaining.length > 0) {
    const missing = remaining
      .map(
        (param: any) =>
          `${param.label} (key: ${param.key}, required by: ${activeSkills
            .filter((s: any) => s.requiredParams.some((rp: any) => rp.key === param.key))
            .map((s: any) => s.id)
            .join(', ')})`
      )
      .join(', ');
    throw new Error(
      `Cannot run agent: required parameters are missing or invalid. ${missing}. ` +
        `Parameters are stored in ~/.omniforge/params.json. Run "omniforge reset" to clear and re-enter parameters.`
    );
  }

  console.log('\n✅ Required agent parameters are satisfied.');
}

export async function runInteractiveAgent(
  initialAgent: Agent,
  initialUserMessage?: string,
): Promise<Agent> {
  await ensureAgentDependencies(initialAgent);

  const tools = getBuiltinToolDefinitions();
  const client = await createLLMClient(initialAgent.provider, initialAgent.model);
  const config = await loadConfig();
  const webSearchStatus = getWebSearchStatus(config);

  if (!webSearchStatus.available) {
    console.log('ℹ️  Web search is unavailable for this run.');
    console.log('   Run "omniforge config" to enable web search and save a provider key.\n');
  }

  // Use agent-specific data directory for file operations.
  const agentDataDir = await ensureAgentDataDir(initialAgent.id);

  const executor = new DefaultToolExecutor(agentDataDir, {
    provider: initialAgent.provider,
    model: initialAgent.model,
    apiKey: config.providers[initialAgent.provider]?.apiKey,
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

  let agent = initialAgent;
  let queuedMessage = initialUserMessage?.trim() ? initialUserMessage : undefined;

  console.log('\n💬 Interactive agent started. Type /exit to stop.\n');

  while (true) {
    const userMessage = queuedMessage ?? (await promptInput('You'));
    queuedMessage = undefined;

    const trimmed = userMessage.trim();
    if (!trimmed) {
      continue;
    }

    if (EXIT_INPUTS.has(trimmed.toLowerCase())) {
      break;
    }

    process.stdout.write('\nAgent: ');
    agent = await runAgentTurn({
      agent,
      userInput: trimmed,
      client,
      toolExecutor: executor,
      tools,
      onTextDelta: (delta) => {
        process.stdout.write(delta);
      },
      onToolCall: (toolCall) => {
        console.log(`\n\n🔧 Tool requested: ${toolCall.name}`);
        if (Object.keys(toolCall.input).length > 0) {
          console.log(`   • Input: ${JSON.stringify(toolCall.input, null, 2)}`);
        }
      },
      onToolCallConfirm: async (toolCall) => {
        console.log(`\n🚦 About to execute tool: ${toolCall.name}`);
        if (Object.keys(toolCall.input).length > 0) {
          console.log(`   • Input preview: ${JSON.stringify(toolCall.input, null, 2)}`);
        }
        return await promptConfirm('Approve this tool execution?');
      },
      onToolResult: (toolCall, result) => {
        const display = result.output.length > 240 ? result.output.substring(0, 240) + '...' : result.output;
        if (result.ok) {
          console.log(`   ✅ ${toolCall.name} output: ${display}`);
        } else {
          console.log(`   ❌ ${toolCall.name} error (or canceled): ${display}`);
        }
      },
    });
    process.stdout.write('\n');
  }

  console.log('\n👋 Agent paused. Run "omniforge agents" to continue later.\n');
  return agent;
}

export async function configureAgentScheduleInteractive(agent: Agent): Promise<Agent> {
  console.clear?.();
  displayBanner();

  const current = agent.schedule;
  if (current?.enabled) {
    printInfo(
      `Current schedule: every day at ${current.dailyTime} (${current.timezone})${current.prompt ? ` with prompt: "${current.prompt}"` : ''}`,
    );
  } else {
    printInfo('This agent has no active schedule.');
  }

  const enable = await promptConfirm('Enable daily schedule for this agent?', Boolean(current?.enabled));
  if (!enable) {
    const updated = clearAgentSchedule(agent);
    await saveAgent(updated);
    printSuccess('Schedule disabled.');
    return updated;
  }

  const detectedTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  let timezone = current?.timezone ?? detectedTimezone;

  const useDetected = await promptConfirm(`Use timezone ${timezone}?`, true);
  if (!useDetected) {
    while (true) {
      const entered = (await promptInput('Enter IANA timezone', timezone)).trim();
      if (isValidIanaTimeZone(entered)) {
        timezone = entered;
        break;
      }
      console.log('Invalid timezone. Example: America/New_York, Europe/London, Asia/Kolkata');
    }
  }

  let dailyTime = current?.dailyTime ?? '09:00';
  while (true) {
    const entered = (await promptInput('Daily run time (HH:mm, 24h)', dailyTime)).trim();
    if (isValidDailyTime(entered)) {
      dailyTime = entered;
      break;
    }
    console.log('Invalid time. Use HH:mm in 24h format (example: 08:30, 21:45).');
  }

  const prompt = await promptInput(
    'Optional scheduled user prompt (leave empty to run without extra prompt)',
    current?.prompt ?? '',
  );

  const updated = setAgentDailySchedule(agent, {
    dailyTime,
    timezone,
    ...(prompt.trim() ? { prompt: prompt.trim() } : {}),
  });

  await saveAgent(updated);
  printSuccess(
    `Schedule saved: daily ${updated.schedule?.dailyTime} (${updated.schedule?.timezone}) • next run: ${updated.schedule?.nextRunAt}`,
  );
  return updated;
}

async function runSingleAgentTurnNow(agent: Agent): Promise<Agent> {
  const message = await promptInput(
    'Optional prompt for this immediate run (leave empty to continue without new user input)',
  );

  await ensureAgentDependencies(agent);
  const tools = getBuiltinToolDefinitions();
  const client = await createLLMClient(agent.provider, agent.model);
  const config = await loadConfig();
  const webSearchStatus = getWebSearchStatus(config);

  if (!webSearchStatus.available) {
    console.log('ℹ️  Web search is unavailable for this run.');
    console.log('   Run "omniforge config" to enable web search and save a provider key.\n');
  }
  const agentDataDir = await ensureAgentDataDir(agent.id);

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

  process.stdout.write('\nAgent: ');
  const updated = await runAgentTurn({
    agent,
    ...(message.trim() ? { userInput: message.trim() } : {}),
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

export async function runAgentsCommand(): Promise<void> {
  while (true) {
    console.clear?.();
    displayBanner();

    const agents = await listAgents();
    if (agents.length === 0) {
      console.log('\nNo agents found. Create one with: omniforge create\n');
      return;
    }

    const chosen = await selectFromList(
      'Select an agent',
      [
        ...agents.map((agent) => ({
          label: agent.name,
          value: agent.id,
          description: `${agent.provider}/${agent.model} • ${
            agent.schedule?.enabled ? `🕒 ${agent.schedule.dailyTime} ${agent.schedule.timezone}` : 'No schedule'
          } • Status: ${agent.status}`,
        })),
        {
          label: 'Exit',
          value: '__exit__',
          description: 'Close agents manager',
        },
      ],
    );

    if (chosen === '__exit__') {
      return;
    }

    let agent = await loadAgent(chosen);
    if (!agent) {
      console.error('Agent not found');
      process.exit(1);
    }

    const action = await selectFromList('Choose action', [
      {
        label: 'Resume interactive agent',
        value: 'resume',
        description: 'Start chat loop and approve tool calls interactively',
      },
      {
        label: 'Run one turn now',
        value: 'run_now',
        description: 'Trigger an immediate autonomous turn once',
      },
      {
        label: 'Edit daily schedule',
        value: 'edit_schedule',
        description: 'Set/disable timezone-aware daily schedule and optional prompt',
      },
      {
        label: 'Back',
        value: 'back',
        description: 'Return to agents list',
      },
    ]);

    if (action === 'back') {
      continue;
    }

    console.clear?.();
    displayBanner();
    console.log(`Agent: ${agent.name}`);
    console.log(`Provider/Model: ${agent.provider}/${agent.model}`);
    console.log(`Status: ${agent.status}`);
    if (agent.schedule?.enabled) {
      console.log(`Schedule: daily ${agent.schedule.dailyTime} (${agent.schedule.timezone})`);
      if (agent.schedule.prompt) {
        console.log(`Scheduled prompt: ${agent.schedule.prompt}`);
      }
      if (agent.schedule.nextRunAt) {
        console.log(`Next run: ${agent.schedule.nextRunAt}`);
      }
    }
    console.log('');

    if (action === 'resume') {
      agent = await runInteractiveAgent(agent);
      await saveAgent(agent);
      continue;
    }

    if (action === 'run_now') {
      agent = await runSingleAgentTurnNow(agent);
      await saveAgent(agent);
      continue;
    }

    if (action === 'edit_schedule') {
      agent = await configureAgentScheduleInteractive(agent);
      await saveAgent(agent);
      continue;
    }
  }
}
