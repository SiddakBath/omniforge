import {
  createLLMClient,
  DefaultToolExecutor,
  findMissingSkillBins,
  findMissingParams,
  generateAgent,
  getBuiltinToolDefinitions,
  getWebSearchStatus,
  getProviderById,
  listSkills,
  loadConfig,
  loadProviderCatalog,
  runAgentTurn,
  ensureAgentDataDir,
  saveConfig,
  saveAgent,
  saveAgentSystemPrompt,
  saveParamValue,
} from '@openforge/core';
import { input, password, select } from '@inquirer/prompts';
import { promptConfirm } from '../utils/interactive.js';
import { displayBanner } from '../utils/banner.js';
import { configureAgentScheduleInteractive, runInteractiveAgent } from './agents.js';

export async function runCreateAgentCommand(initialRequest: string): Promise<void> {
  displayBanner();
  console.log('Create agent\n');

  const request =
    initialRequest ||
    (await input({
      message: 'Step 1/6 — Describe the agent you want to create',
      validate: (value) => (value.trim().length > 0 ? true : 'Agent description is required.'),
    }));

  if (!request.trim()) {
    throw new Error('Agent description is required');
  }

  const config = await loadConfig();
  const webSearchStatus = getWebSearchStatus(config);
  if (!webSearchStatus.available) {
    console.log('ℹ️  Web search is currently unavailable.');
    console.log('   Skills and agent runs can proceed, but live web research will be limited.');
    console.log('   Run "openforge config" to enable web search and save a key.\n');
  }
  const catalog = await loadProviderCatalog();

  let provider = await select({
    message: 'Step 2/6 — Choose your runtime provider',
    choices: catalog.map((entry: { name: string; id: string; models: any[] }) => ({
      name: `${entry.name} (${entry.models.length} models)`,
      value: entry.id,
      description: `Provider ID: ${entry.id}`,
    })),
    pageSize: 10,
  });

  let providerEntry = await getProviderById(provider);
  if (!providerEntry) {
    throw new Error(`Unknown provider ${provider}`);
  }

  let model = '';
  while (true) {
    const selectedModel = await select({
      message: `Step 3/6 — Choose runtime model (${providerEntry.name})`,
      choices: [
        ...providerEntry.models.map((entry: { id: string; contextWindow: number; tags: string[] }) => ({
          name: entry.id,
          value: entry.id,
          description: `${entry.contextWindow.toLocaleString()} context • ${entry.tags.join(', ')}`,
        })),
        {
          name: '← Back to provider selection',
          value: '__back__',
          description: 'Pick a different provider',
        },
      ],
      pageSize: 12,
    });

    if (selectedModel === '__back__') {
      provider = await select({
        message: 'Step 2/6 — Choose your runtime provider',
        choices: catalog.map((entry: { name: string; id: string; models: any[] }) => ({
          name: `${entry.name} (${entry.models.length} models)`,
          value: entry.id,
          description: `Provider ID: ${entry.id}`,
        })),
        pageSize: 10,
      });

      providerEntry = await getProviderById(provider);
      if (!providerEntry) {
        throw new Error(`Unknown provider ${provider}`);
      }
      continue;
    }

    model = selectedModel;
    break;
  }

  console.log('\nGenerating agent...');

  const output = await generateAgent({ request, provider, model });

  const assignedSkills = (await listSkills()).filter((skill: { id: string }) => output.agent.skills.includes(skill.id));

  console.log('\n✅ Agent generated with assigned skills:');
  assignedSkills.forEach((skill: { id: string; name: string; description?: string; requiredBins: string[] }) => {
    console.log(`  • ${skill.id}`);
    if (skill.description) {
      console.log(`    ${skill.description}`);
    }
    if (skill.requiredBins.length > 0) {
      console.log(`    Requires bins: ${skill.requiredBins.join(', ')}`);
    }
  });

  const requiredParamsFromSkills = assignedSkills.flatMap(
    (skill: { requiredParams: Array<{ key: string; label: string; description: string; secret: boolean }> }) =>
      skill.requiredParams,
  );

  const missing = output.missingParams.length > 0 ? output.missingParams : await findMissingParams(requiredParamsFromSkills);

  if (missing.length > 0) {
    console.log('\nStep 4/6 — Some skills need additional parameters:');
    missing.forEach((param: { key?: string; label: string; description?: string }) => {
      console.log(`  • ${param.label}${param.description ? ` - ${param.description}` : ''}`);
      if (param.key) {
        const skillsNeedingIt = requiredParamsFromSkills
          .filter((p: { key: string }) => p.key === param.key)
          .map((p: any) => {
            const skill = assignedSkills.find((s: any) => s.requiredParams.some((rp: any) => rp.key === param.key));
            return skill?.id;
          })
          .filter(Boolean);
        if (skillsNeedingIt.length > 0) {
          console.log(`    Required by: ${[...new Set(skillsNeedingIt)].join(', ')}`);
        }
      }
    });
    console.log('');

    for (const param of missing) {
      const value = param.secret
        ? await password({
            message: `🔐 ${param.label}`,
            mask: '*',
            validate: (v) => (v.trim().length > 0 ? true : `${param.label} is required.`),
          })
        : await input({
            message: `📌 ${param.label}`,
            default: '',
            validate: (v) => (v.trim().length > 0 ? true : `${param.label} is required.`),
          });
      await saveParamValue(param, value);
    }
  } else {
    console.log('\nStep 4/6 — ✅ No additional parameters needed.\n');
  }

  const remainingMissing = await findMissingParams(requiredParamsFromSkills);
  const missingBins = await findMissingSkillBins(assignedSkills);

  if (remainingMissing.length > 0) {
    const missing = remainingMissing
      .map(
        (param: any) =>
          `${param.label} (key: ${param.key}, required by: ${assignedSkills
            .filter((s: any) => s.requiredParams.some((rp: any) => rp.key === param.key))
            .map((s: any) => s.id)
            .join(', ')})`
      )
      .join(', ');
    throw new Error(
      `Cannot start agent: required parameters are missing or invalid. ${missing}. ` +
      `Parameters are stored in ~/.openforge/params.json. Run "openforge reset" to clear and re-enter parameters.`
    );
  }

  if (missingBins.length > 0) {
    const list = missingBins.map((item) => `${item.bin} (required by ${item.skillId})`).join(', ');
    throw new Error(`Cannot start agent: missing required binaries: ${list}`);
  }

  console.log('✅ All skill parameters configured successfully.\n');

  await saveAgentSystemPrompt(output.agent.id, output.systemPrompt);
  await saveAgent(output.agent);

  console.log('Step 5/7 — Configure optional daily schedule.\n');
  let createdAgent = await configureAgentScheduleInteractive(output.agent);

  const providerConfig = config.providers[provider];
  const apiKeyNeeded = !providerConfig?.apiKey;
  if (apiKeyNeeded) {
    const apiKey = await password({
      message: `Step 6/7 — Enter ${providerEntry.name} API key`,
      mask: '*',
      validate: (v) => (v.trim().length > 0 ? true : 'API key is required.'),
    });
    config.providers[provider] = { apiKey };
    await saveConfig(config);
    console.log('✅ API key saved.\n');
  } else {
    console.log(`Step 6/7 — ✅ Using existing ${providerEntry.name} API key.\n`);
  }

  const client = await createLLMClient(provider, model);
  
  // Ensure agent data directory exists for agent to write files to
  const agentDataDir = await ensureAgentDataDir(createdAgent.id);
  
  const executor = new DefaultToolExecutor(agentDataDir, {
    provider,
    model,
    apiKey: config.providers[provider]?.apiKey,
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
  const tools = getBuiltinToolDefinitions();

  console.log(`Step 6a/7 — Initializing ${tools.length} built-in tools:\n`);
  tools.forEach((tool: { name: string; description?: string }) => {
    console.log(`  • ${tool.name}${tool.description ? ` - ${tool.description}` : ''}`);
  });
  console.log('');

  console.log('Step 7/7 — Running first agent turn...\n');

  // Generate an operational prompt for the first turn instead of using the creation request.
  // The creation request describes what the agent should be (e.g., "an agent that swing trades"),
  // not what it should do now. This prevents the agent from trying to set itself up or generate
  // something instead of executing its actual mission.
  const firstTurnPrompt = 'Execute your mission now. Proceed with your full workflow and report results.';

  const agent = await runAgentTurn({
    agent: createdAgent,
    userInput: firstTurnPrompt,
    client,
    toolExecutor: executor,
    tools,
    onTextDelta: (chunk: string) => {
      process.stdout.write(chunk);
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

  console.log('\n\n✅ Agent created successfully.');
  console.log(`Agent ID: ${agent.id}`);
  console.log(`Status: ${agent.status}`);
  console.log(`Provider: ${providerEntry.name}`);
  console.log(`Model: ${model}`);
  console.log(`Skills: ${assignedSkills.map((s: { id: string }) => s.id).join(', ')}`);
  console.log(`Tools: ${tools.map((t: { name: string }) => t.name).join(', ')}`);
  console.log('\nEntering interactive agent loop now...');
  await runInteractiveAgent(agent);
}
