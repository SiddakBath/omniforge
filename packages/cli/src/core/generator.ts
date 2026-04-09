import { randomUUID } from 'crypto';
import { z } from 'zod';
import { createMessage } from './agent-runtime.js';
import { getBuiltinToolDefinitions } from './builtin-tools/registry.js';
import { getWebSearchStatus, loadConfig } from './config-store.js';
import { createLLMClient } from './llm-factory.js';
import { assertNonStreamingResponse } from './llm.js';
import { findMissingParams } from './params-store.js';
import { parseSkillMarkdown } from './skill-markdown.js';
import { listSkills, saveSkillBundle } from './skill-store.js';
import { DefaultToolExecutor } from './tool-executor.js';
import type {
  Agent,
  Message,
  RequiredParam,
  Skill,
  SkillAuditResult,
  SkillBundle,
  ToolDefinition,
  ToolExecutor,
} from './types.js';

const SkillAuditSchema = z.object({
  useSkillIds: z.array(z.string()).default([]),
  createSkills: z
    .array(
      z.object({
        name: z.string(),
        description: z.string(),
      }),
    )
    .default([]),
});

export interface GenerateAgentInput {
  request: string;
  provider?: string;
  model?: string;
}

export interface GenerateAgentOutput {
  agent: Agent;
  systemPrompt: string;
  newSkills: Skill[];
  missingParams: RequiredParam[];
}

const SKILL_RESEARCH_MAX_STEPS = 6;
const SKILL_SEPARATOR = '===SKILL_SEPARATOR===';

function splitBatchSkillMarkdown(rawMarkdownBatch: string): string[] {
  const chunks: string[] = [];
  let current: string[] = [];

  for (const line of rawMarkdownBatch.split(/\r?\n/)) {
    if (line.trim() === SKILL_SEPARATOR) {
      const chunk = current.join('\n').trim();
      if (chunk.length > 0) {
        chunks.push(chunk);
      }
      current = [];
      continue;
    }

    current.push(line);
  }

  const finalChunk = current.join('\n').trim();
  if (finalChunk.length > 0) {
    chunks.push(finalChunk);
  }

  return chunks;
}

export async function generateAgent(input: GenerateAgentInput): Promise<GenerateAgentOutput> {
  const config = await loadConfig();
  const webSearchStatus = getWebSearchStatus(config);
  const client = await createLLMClient(input.provider, input.model);
  const existingSkills = await listSkills();
  const builtInTools = getBuiltinToolDefinitions();
  const skillResearchTools = builtInTools.filter((tool) => tool.name === 'web_search');
  const skillResearchExecutor = new DefaultToolExecutor(process.cwd(), {
    ...(input.provider ? { provider: input.provider } : {}),
    ...(input.model ? { model: input.model } : {}),
    webSearch: {
      enabled: config.webSearch.enabled,
      ...(config.webSearch.provider ? { provider: config.webSearch.provider } : {}),
      providers: Object.fromEntries(
        Object.entries(config.webSearch.providers)
          .filter(([, value]) => Boolean(value?.apiKey?.trim()))
          .map(([provider, value]) => [provider, { apiKey: value!.apiKey.trim() }]),
      ),
    },
  });

  if (!webSearchStatus.available) {
    console.log('⚠️  Web search is not configured for generation research.');
    console.log('   Some generated skills may be less current without live web context.');
    console.log('   Run "omniforge config" to enable web search and add a provider key.\n');
  }

  console.log('\n📊 Step 1/3 — Auditing skills...');
  console.log(`  Analyzing request: "${input.request}"\n`);

  const audit = await runSkillAudit(client, input.request, existingSkills);

  if (audit.useSkillIds.length > 0) {
    console.log(`  ✓ Will reuse ${audit.useSkillIds.length} existing skill(s):`);
    audit.useSkillIds.forEach((id) => console.log(`    • ${id}`));
  }
  if (audit.createSkills.length > 0) {
    console.log(`  ✓ Will create ${audit.createSkills.length} new skill(s):`);
    audit.createSkills.forEach((skill) => console.log(`    • ${skill.name}: ${skill.description}`));
  }

  const created: Skill[] = [];
  if (audit.createSkills.length > 0) {
    console.log(`\n🔨 Step 2/3 — Creating ${audit.createSkills.length} skill(s)...`);
    const bundles = await createSkillPlaybookBatch(
      client,
      input.request,
      audit.createSkills,
      existingSkills,
      skillResearchTools,
      skillResearchExecutor,
    );
    for (let i = 0; i < bundles.length; i++) {
      const bundle = bundles[i]!;
      console.log(`  [${i + 1}/${bundles.length}] Generated "${bundle.skill.name}"`);
      const saved = await saveSkillBundle(bundle);
      created.push(saved);
      console.log(`        ✓ Saved to disk`);
    }
  } else {
    console.log(`\n✓ Step 2/3 — No new skills needed`);
  }

  console.log(`\n📋 Step 3/3 — Assembling agent...\n`);

  const allSkills = await listSkills();
  const assignedSkillIds = Array.from(new Set([...audit.useSkillIds, ...created.map((skill) => skill.id)]));
  const assignedSkills = allSkills.filter((skill) => assignedSkillIds.includes(skill.id));

  const allRequiredParams = dedupeParams(
    assignedSkills.flatMap((skill) => skill.requiredParams),
  );

  const missingParams = await findMissingParams(allRequiredParams);
  const systemPrompt = await buildSystemPrompt(input.request, assignedSkills, builtInTools);

  const agent: Agent = {
    id: randomUUID(),
    name: await generateAgentName(input.request),
    description: input.request,
    skills: assignedSkillIds,
    provider: input.provider ?? '',
    model: input.model ?? '',
    status: 'ready',
    messages: [],
    checkpoints: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  return {
    agent,
    systemPrompt,
    newSkills: created,
    missingParams,
  };
}

async function runSkillAudit(client: Awaited<ReturnType<typeof createLLMClient>>, request: string, skills: Skill[]): Promise<SkillAuditResult> {
  console.log(`  Calling LLM to audit skills...`);
  const toolNames = getBuiltinToolDefinitions().map((tool) => tool.name);

  const response = await client.complete(
    [
      createMessage(
        'system',
        [
          '# Skill Selection for Autonomous Agents',
          '',
          'Skills encode reusable business logic, domain expertise, and integration workflows.',
          'They are NOT basic prompt instructions or generic helpers.',
          '',
          'Distinction:',
          '- **Tools** (built-in): read_file, write_file, terminal_command, http_request, web_search',
          '- **Skills** (reusable integrations): Google Workspace (Gmail, Calendar, Drive), GitHub (PRs, issues, workflows), Slack (messaging, channels)',
          '',
          'When to USE a skill:',
          '- Multi-step workflow with domain-specific decision logic.',
          '- Integration with external services (e.g., "manage Gmail threads", "check GitHub PR status").',
          '- Repeated patterns (e.g., "always validate sources before citing", "follow GitHub PR conventions").',
          '- Risk mitigation (e.g., "get user approval before sending external comms", "verify email before sending").',
          '',
          'When NOT to create a skill:',
          '- Simple tool usage (tools handle this directly).',
          '- One-off instructions that don\'t repeat.',
          '- Generic advice that applies to all tasks (belongs in agent behavior, not skills).',
          '',
          'Prefer reusing existing skills. Only create new skills for genuinely new domains/integrations.',
          'The user message includes the full list of existing skills in the `skills` array. Evaluate them and reuse any that fit, rather than creating duplicates.',
          '',
          '## Output Format (STRICT JSON ONLY)',
          'Return: { useSkillIds: [string], createSkills: [{ name: string, description: string }] }',
          'No markdown, no extra fields.',
        ].join('\n'),
      ),
      createMessage(
        'user',
        JSON.stringify({
          request,
          builtInTools: toolNames,
          skills: skills.map((skill) => ({
            id: skill.id,
            name: skill.name,
            description: skill.description,
            requiredBins: skill.requiredBins,
            requiredParams: skill.requiredParams.map((param) => ({
              key: param.key,
              label: param.label,
              description: param.description,
              secret: param.secret,
            })),
          })),
        }),
      ),
    ],
    [],
    false,
  );
  const resolved = assertNonStreamingResponse(response);

  const parsed = parseJsonSafely(resolved.text);
  const result = SkillAuditSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `Skill audit returned invalid schema: ${JSON.stringify(result.error, null, 2)}\n` +
      `Raw response: ${resolved.text}`,
    );
  }

  return result.data;
}

async function createSkillPlaybookBatch(
  client: Awaited<ReturnType<typeof createLLMClient>>,
  request: string,
  skillsToCreate: Array<{ name: string; description: string }>,
  existingSkills: Skill[],
  researchTools: ToolDefinition[],
  toolExecutor: ToolExecutor,
): Promise<SkillBundle[]> {
  console.log('      • Calling LLM to generate markdown skills in batch...');

  const skillsListForPrompt = skillsToCreate
    .map((skill, idx) => `${idx + 1}. ${skill.name}: ${skill.description}`)
    .join('\n');

  const messages: Message[] = [
    createMessage(
      'system',
      [
        '# Batch Skill Generator',
        '',
        'Generate multiple reusable skills for autonomous agents in a single batch.',
        'This ensures consistency across skills, especially for shared parameters and integrations.',
        'Skills encode domain expertise and integration workflows. They are NOT generic advice.',
        '',
        'CRITICAL: Coordinate Parameter Naming',
        'When multiple skills need the same external service credentials or parameters:',
        '- Use IDENTICAL parameter names across all skills in this batch.',
        '- Example: If both skills integrate with Alpaca API, BOTH should use ALPACA_API_KEY and ALPACA_SECRET_KEY.',
        '- Do NOT create variations like ALPACA_API_SECRET, ALPACA_KEY, etc. Use consistent naming.',
        '- This prevents duplicate credential requirements and reduces user confusion.',
        '',
        'Research guidance (conditional, not mandatory):',
        '- Use web_search ONLY if skills require integration with external tools/APIs AND no existing skill already covers these capabilities.',
        '- Example: If creating a "GitHub PR Manager" skill, search for current GitHub API endpoints and authentication methods.',
        '- Example: If creating a workflow that reuses existing skill capabilities, web_search may not be necessary.',
        '- When researching: Find recent, practical information about tool/API surfaces, CLI tools, and integration patterns.',
        '- You may run multiple web_search calls within the generation loop to gather information incrementally.',
        '',
        'Design principles:',
        '- **Service-integrated**: Connect to external platforms (Gmail, GitHub, Slack, Google Drive, etc.).',
        '- **Multi-step workflows**: Break complex tasks into clear phases with decision gates.',
        '- **Risk-aware**: Identify approval points, validation steps, and error recovery.',
        '- **Tool-integrated**: Reference built-in tools (web_search, http_request, terminal_command, read_file) for research, API calls, and data handling.',
        '- **Reusable**: Design for multiple use cases within the domain, not one-off tasks.',
        '',
        'Structure each skill:',
        '1. **Objectives** - What the workflow achieves and constraints.',
        '2. **API/Integration details** - Services, endpoints, authentication patterns, rate limits.',
        '3. **Workflow phases** - Numbered steps with decision logic and error handling.',
        '4. **Validation/Guardrails** - Critical checks and approval points before irreversible actions.',
        '',
        'Examples of STRONG skills:',
        '- "Google Workspace": Read/compose/reply to Gmail, schedule Calendar events, manage Drive files, query Sheets data.',
        '- "GitHub": Check PR status, view CI logs, create/comment on issues, query branches, trigger workflows.',
        '- "Slack": Send messages, manage channels, search message history, post rich content.',
        '',
        'Examples of WEAK skills (avoid):',
        '- "Ask user for details" (belongs in agent behavior)',
        '- "Write clearly" (too generic)',
        '- "Read and summarize" (simple tool use, no integration logic)',
        '',
        'Existing skills are included in the user message as `existingSkills`. Use that list as a reference to avoid generating duplicates or overlapping skills.',
        '- If any existing skill already defines an equivalent required parameter, reuse that same parameter key in this batch as well (do not create duplicate credentials).',
        '',
        'Required and Optional Parameters (credentials/API keys):',
        '- Required parameters: declare in metadata.requires.params as UPPERCASE_SNAKE_CASE.',
        '- Optional parameters: declare in metadata.requires.optional as UPPERCASE_SNAKE_CASE.',
        '- Examples:',
        '  metadata.requires.params: [GITHUB_TOKEN, GMAIL_API_KEY]  # Must be provided',
        '  metadata.requires.optional: [GOOGLE_WORKSPACE_ADMIN_EMAIL, DEFAULT_CALENDAR_ID]  # Optional with sensible defaults',
        '- Use optional for parameters that have defaults or aren\'t always needed.',
        '- In markdown body, reference as ${PARAM_NAME}, NOT actual values.',
        '- Runtime resolves credentials securely before execution.',
        '',
        'Output format (CRITICAL for parsing):',
        '- Generate ALL skills in a single response.',
        '- Separate each skill with exactly this delimiter on its own line: ===SKILL_SEPARATOR===',
        '- Each skill must be valid markdown with YAML frontmatter.',
        '- First skill starts immediately (no delimiter before it).',
        '- Last skill ends the response (no delimiter after it).',
        '- Example structure:',
        '  ---',
        '  name: Skill 1',
        '  description: ...',
        '  metadata:',
        '    requires:',
        '      params: [SHARED_PARAM]',
        '  ---',
        '  [Skill 1 content]',
        '  ===SKILL_SEPARATOR===',
        '  ---',
        '  name: Skill 2',
        '  description: ...',
        '  metadata:',
        '    requires:',
        '      params: [SHARED_PARAM]  # Same param key as Skill 1!',
        '  ---',
        '  [Skill 2 content]',
      ].join('\n'),
    ),
    createMessage(
      'user',
      JSON.stringify({
        request,
        skillsToCreate,
        availableResearchTools: researchTools.map((tool) => ({
          name: tool.name,
          description: tool.description,
        })),
        existingSkills: existingSkills.map((skill) => ({
          id: skill.id,
          name: skill.name,
          description: skill.description,
          requiredBins: skill.requiredBins,
          requiredParams: skill.requiredParams.map((param) => ({
            key: param.key,
            label: param.label,
            description: param.description,
            secret: param.secret,
          })),
          contentPreview: skill.content.slice(0, 240),
        })),
      }),
    ),
  ];

  let rawMarkdownBatch = '';

  for (let step = 0; step < SKILL_RESEARCH_MAX_STEPS; step++) {
    const response = await client.complete(messages, researchTools, false);
    const resolved = assertNonStreamingResponse(response);

    if (resolved.text.trim()) {
      rawMarkdownBatch = resolved.text.trim();
      messages.push(createMessage('assistant', rawMarkdownBatch));
    }

    if (resolved.toolCalls.length === 0) {
      break;
    }

    for (const toolCall of resolved.toolCalls) {
      const result = await toolExecutor.execute(toolCall);
      const toolMessage: Message = {
        id: randomUUID(),
        role: 'tool',
        name: toolCall.name,
        toolCallId: toolCall.id,
        content: JSON.stringify({ ok: result.ok, output: result.output }),
        createdAt: new Date().toISOString(),
      };
      messages.push(toolMessage);
    }
  }

  if (!rawMarkdownBatch.trim()) {
    throw new Error('Batch skill generation returned no markdown content.');
  }

  // Parse the batch response into individual skills
  const skillMarkdowns = splitBatchSkillMarkdown(rawMarkdownBatch);

  if (skillMarkdowns.length !== skillsToCreate.length) {
    throw new Error(
      `Expected ${skillsToCreate.length} skills but batch generation returned ${skillMarkdowns.length} skills. ` +
      `Make sure each skill is separated by exactly "${SKILL_SEPARATOR}" on its own line.`,
    );
  }

  const bundles: SkillBundle[] = skillMarkdowns.map((markdown, idx) => {
    if (!markdown) {
      throw new Error(`Skill ${idx + 1} markdown is empty.`);
    }
    const skill = parseSkillMarkdown(markdown, { idHint: skillsToCreate[idx]!.name });
    return { skill, markdown };
  });

  return bundles;
}

async function generateAgentName(request: string): Promise<string> {
  const first = request.trim().split(/[.?!\n]/)[0] ?? 'Agent';
  return first.length <= 70 ? first : `${first.slice(0, 67)}...`;
}

async function buildSystemPrompt(request: string, skills: Skill[], tools: ToolDefinition[]): Promise<string> {
  // CRITICAL INVARIANT: Skills are NEVER callable tools. They are reference material injected
  // into the system prompt for strategy and workflow guidance only. The tools array must contain
  // ONLY built-in tools (read_file, write_file, terminal_command, http_request, web_search).
  // Skills are loaded from the agent's skills array and injected as narrative content.
  
  const toolLines = tools.map((tool) => {
    const keys = getToolParameterKeys(tool.parameters);
    const suffix = keys.length > 0 ? ` | params: ${keys.join(', ')}` : '';
    return `- ${tool.name}: ${tool.description}${suffix}`;
  });

  const skillBlocks = skills.map((skill) => {
    const metadataBlock = skill.metadata ? `Metadata: ${JSON.stringify(skill.metadata)}\n` : '';
    const homepageBlock = skill.homepage ? `Homepage: ${skill.homepage}\n` : '';

    return [
      `### ${skill.name} (${skill.id})`,
      `Description: ${skill.description}`,
      homepageBlock.trim(),
      metadataBlock.trim(),
      skill.content,
    ]
      .filter((line) => line.length > 0)
      .join('\n');
  });

  // Build parameter documentation and skill-param associations
  const allParams = dedupeParams(skills.flatMap((skill) => skill.requiredParams));
  const paramDocumentation = buildParameterDocumentation(allParams, skills);

  // Generate a tailored prompt based on the user's request
  const tailoredPrompt = await generateTailoredPrompt(request, skills, tools);

  return [
    'You are an OmniForge agent.',
    '',
    tailoredPrompt,
    '',
    'Behavioral guidelines:',
    '- Act autonomously for clearly safe actions.',
    '- Ask the user for clarification when ambiguity changes outcomes.',
    '- Report progress in concise checkpoints.',
    '- If a tool fails, explain cause and next best action.',
    '',
    'Tools (executable capabilities):',
    ...toolLines,
    '',
    'Your skills:',
    ...(skillBlocks.length > 0
      ? skillBlocks
      : ['No additional workflow guides are active. Use built-in tools and your judgment.']),
    '',
    ...(paramDocumentation.length > 0
      ? [
          'Available Parameters:',
          'The following parameters are pre-configured and automatically injected into tool calls.',
          'Reference them in tool inputs using ${PARAM_NAME} format, and the runtime will resolve them.',
          '',
          ...paramDocumentation,
        ]
      : []),
    '',
    'Important:',
    '- Tools are executable functions you can call.',
    '- Workflow guides are narrative instructions for strategy and best practices. You cannot call them—use them to inform your approach.',
    '- Skill parameters: use ${PARAM_NAME} to access injected credentials and params; do not use %PARAM_NAME% for skill params.',
    '- Shell/OS environment variables: %VAR_NAME% is allowed when intentionally using local shell env vars, but is not how skill param injection works.',
    '- Always prefer the available tools over creating workarounds.',
  ].join('\n');
}

async function generateTailoredPrompt(request: string, skills: Skill[], tools: ToolDefinition[]): Promise<string> {
  const client = await createLLMClient();
  
  const toolNames = tools.map((t) => t.name).join(', ');
  const skillNames = skills.map((s) => `${s.name} (${s.description})`).join('\n  ');

  const response = await client.complete(
    [
      createMessage(
        'system',
        [
          '# Prompt Generator for Autonomous Agents',
          '',
          'You are a specialized prompt engineer. Your job is to generate a focused, actionable prompt section for an autonomous agent based on their mission and available capabilities.',
          '',
          'The output should be 2-3 paragraphs that:',
          '1. Clearly articulate the core mission and any sub-goals',
          '2. Highlight key challenges, constraints, and success criteria specific to this mission',
          '3. Outline the strategic approach—which skills/tools are primary, what sequence is expected, decision points',
          '4. Note any critical guardrails or risk mitigation measures',
          '',
          'Be specific and actionable. Reference the available skills and tools by name. The agent reading this should immediately understand what they need to accomplish and how.',
          'Do NOT include generic advice. Focus exclusively on what makes this mission unique.',
        ].join('\n'),
      ),
      createMessage(
        'user',
        JSON.stringify({
          userRequest: request,
          availableTools: toolNames,
          availableSkills: skillNames.length > 0 ? skillNames : 'None',
        }),
      ),
    ],
    [],
    false,
  );

  const resolved = assertNonStreamingResponse(response);
  return resolved.text.trim();
}

function parseJsonSafely(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (firstError) {
    const match = raw.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (!match) {
      throw new Error(`Unable to parse JSON response. First error: ${firstError}. Raw text: ${raw}`);
    }
    try {
      return JSON.parse(match[0]);
    } catch (secondError) {
      throw new Error(
        `Unable to parse JSON response from extracted content. First error: ${firstError}. Second error: ${secondError}. Extracted text: ${match[0]}`,
      );
    }
  }
}

function getToolParameterKeys(parameters: Record<string, unknown>): string[] {
  const props = (parameters.properties ?? {}) as Record<string, unknown>;
  return Object.keys(props);
}

function dedupeParams(params: RequiredParam[]): RequiredParam[] {
  const map = new Map<string, RequiredParam>();
  for (const param of params) {
    map.set(param.key, param);
  }
  return [...map.values()];
}

function buildParameterDocumentation(allParams: RequiredParam[], skills: Skill[]): string[] {
  if (allParams.length === 0) {
    return [];
  }

  const lines: string[] = [];

  for (const param of allParams) {
    // Find which skills require this parameter
    const skillsThatNeed = skills
      .filter((skill) => skill.requiredParams.some((p) => p.key === param.key))
      .map((skill) => skill.id);

    const isSecret = param.secret ? '🔐' : '📌';
    lines.push(`- ${isSecret} ${param.key}`);
    if (param.description) {
      lines.push(`  Description: ${param.description}`);
    }
    if (skillsThatNeed.length > 0) {
      lines.push(`  Required by: ${skillsThatNeed.join(', ')}`);
    }
    lines.push('');
  }

  return lines;
}
