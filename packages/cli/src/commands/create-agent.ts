import {
  createLLMClient,
  DefaultToolExecutor,
  findMissingSkillBins,
  findMissingParams,
  generateAgentSession,
  getBuiltinToolDefinitions,
  getProviderById,
  listSkills,
  loadConfig,
  loadProviderCatalog,
  runAgentTurn,
  saveConfig,
  saveParamValue,
  saveSession,
  ensureSessionDataDir,
} from '@openforge/core';
import { input, password, select } from '@inquirer/prompts';
import { displayBanner } from '../utils/banner.js';
import { runInteractiveSession } from './sessions.js';

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

  console.log('\nGenerating agent session...');

  const output = await generateAgentSession({ request, provider, model });

  const assignedSkills = (await listSkills()).filter((skill: { id: string }) => output.session.skills.includes(skill.id));

  console.log('\n✅ Session generated with assigned skills:');
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

  await saveSession(output.session);

  const providerConfig = config.providers[provider];
  const apiKeyNeeded = !providerConfig?.apiKey;
  if (apiKeyNeeded) {
    const apiKey = await password({
      message: `Step 5/6 — Enter ${providerEntry.name} API key`,
      mask: '*',
      validate: (v) => (v.trim().length > 0 ? true : 'API key is required.'),
    });
    config.providers[provider] = { apiKey };
    await saveConfig(config);
    console.log('✅ API key saved.\n');
  } else {
    console.log(`Step 5/6 — ✅ Using existing ${providerEntry.name} API key.\n`);
  }

  const client = await createLLMClient(provider, model);
  
  // Ensure session data directory exists for agent to write files to
  const sessionDataDir = await ensureSessionDataDir(output.session.id);
  
  const executor = new DefaultToolExecutor(sessionDataDir, {
    provider,
    model,
    apiKey: config.providers[provider]?.apiKey,
  });
  const tools = getBuiltinToolDefinitions();

  console.log(`Step 5a/6 — Initializing ${tools.length} built-in tools:\n`);
  tools.forEach((tool: { name: string; description?: string }) => {
    console.log(`  • ${tool.name}${tool.description ? ` - ${tool.description}` : ''}`);
  });
  console.log('');

  console.log('Step 6/6 — Running first agent turn...\n');

  const session = await runAgentTurn({
    session: output.session,
    userInput: request,
    client,
    toolExecutor: executor,
    tools,
    onTextDelta: (chunk: string) => {
      process.stdout.write(chunk);
    },
    onToolCall: (toolCall) => {
      process.stdout.write(`\n\n🔧 Calling tool: ${toolCall.name}`);
      if (Object.keys(toolCall.input).length > 0) {
        process.stdout.write('\n   Input: ' + JSON.stringify(toolCall.input));
      }
      process.stdout.write('\n');
    },
    onToolResult: (toolCall, result) => {
      process.stdout.write(`   ✓ Tool returned: `);
      if (result.ok) {
        const output = result.output.length > 200 ? result.output.substring(0, 200) + '...' : result.output;
        process.stdout.write(output);
      } else {
        process.stdout.write(`Error: ${result.output}`);
      }
      process.stdout.write('\n');
    },
  });

  console.log('\n\n✅ Agent created successfully.');
  console.log(`Session ID: ${session.id}`);
  console.log(`Status: ${session.status}`);
  console.log(`Provider: ${providerEntry.name}`);
  console.log(`Model: ${model}`);
  console.log(`Skills: ${assignedSkills.map((s: { id: string }) => s.id).join(', ')}`);
  console.log(`Tools: ${tools.map((t: { name: string }) => t.name).join(', ')}`);
  console.log('\nEntering interactive session now...');
  await runInteractiveSession(session);
}
