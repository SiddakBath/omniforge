import {
  type AgentSession,
  createLLMClient,
  DefaultToolExecutor,
  findMissingSkillBins,
  listSessions,
  listSkills,
  loadConfig,
  loadSession,
  runAgentTurn,
  findMissingParams,
  getBuiltinToolDefinitions,
  saveParamValue,
  ensureSessionDataDir,
} from '@openforge/core';
import { selectFromList, promptInput, promptPassword } from '../utils/interactive.js';
import { displayBanner } from '../utils/banner.js';

const EXIT_INPUTS = new Set(['/exit', 'exit', '/quit', 'quit']);

async function ensureSessionDependencies(session: AgentSession): Promise<void> {
  const assignedSkills = await listSkills();
  const activeSkills = assignedSkills.filter((skill) => session.skills.includes(skill.id));
  const requiredParams = activeSkills.flatMap((skill) => skill.requiredParams);
  const missingParams = await findMissingParams(requiredParams);
  const missingBins = await findMissingSkillBins(activeSkills);

  if (missingBins.length > 0) {
    const list = missingBins.map((item) => `${item.bin} (required by ${item.skillId})`).join(', ');
    throw new Error(`Cannot run session: missing required binaries: ${list}`);
  }

  if (missingParams.length === 0) {
    return;
  }

  console.log('\n⚙️  Session requires additional parameters before running:');
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
      `Cannot run session: required parameters are missing or invalid. ${missing}. ` +
        `Parameters are stored in ~/.openforge/params.json. Run "openforge reset" to clear and re-enter parameters.`
    );
  }

  console.log('\n✅ Required session parameters are satisfied.');
}

export async function runInteractiveSession(
  initialSession: AgentSession,
  initialUserMessage?: string,
): Promise<AgentSession> {
  await ensureSessionDependencies(initialSession);

  const tools = getBuiltinToolDefinitions();
  const client = await createLLMClient(initialSession.provider, initialSession.model);
  const config = await loadConfig();
  
  // Use session-specific data directory for agent to write files to
  const sessionDataDir = await ensureSessionDataDir(initialSession.id);
  
  const executor = new DefaultToolExecutor(sessionDataDir, {
    provider: initialSession.provider,
    model: initialSession.model,
    apiKey: config.providers[initialSession.provider]?.apiKey,
  });

  let session = initialSession;
  let queuedMessage = initialUserMessage?.trim() ? initialUserMessage : undefined;

  console.log('\n💬 Interactive session started. Type /exit to stop.\n');

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
    session = await runAgentTurn({
      session,
      userInput: trimmed,
      client,
      toolExecutor: executor,
      tools,
      onTextDelta: (delta) => {
        process.stdout.write(delta);
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
    process.stdout.write('\n');
  }

  console.log('\n👋 Session paused. Run "openforge sessions" to continue later.\n');
  return session;
}

export async function runSessionsCommand(): Promise<void> {
  console.clear?.();
  displayBanner();
  const sessions = await listSessions();

  if (sessions.length === 0) {
    console.log('\nNo sessions found. Create one with: openforge create\n');
    return;
  }

  const chosen = await selectFromList(
    'Select a session to resume',
    sessions.map((session) => ({
      label: session.name,
      value: session.id,
      description: `${session.provider}/${session.model} • Status: ${session.status}`,
    }))
  );

  const session = await loadSession(chosen);
  if (!session) {
    console.error('Session not found');
    process.exit(1);
  }

  console.clear?.();
  console.log(`Resuming session: ${session.name}`);
  console.log(`Provider/Model: ${session.provider}/${session.model}`);
  console.log(`Status: ${session.status}`);

  await runInteractiveSession(session);
}
