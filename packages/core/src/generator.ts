import { randomUUID } from 'crypto';
import { z } from 'zod';
import { createMessage } from './agent-runtime.js';
import { getBuiltinToolDefinitions } from './builtin-tools/registry.js';
import { createLLMClient } from './llm-factory.js';
import { assertNonStreamingResponse } from './llm.js';
import { findMissingParams } from './params-store.js';
import { parseSkillMarkdown } from './skill-markdown.js';
import { listSkills, saveSkillBundle } from './skill-store.js';
import type { AgentSession, RequiredParam, Skill, SkillAuditResult, SkillBundle, ToolDefinition } from './types.js';

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
  session: AgentSession;
  newSkills: Skill[];
  missingParams: RequiredParam[];
}

export async function generateAgentSession(input: GenerateAgentInput): Promise<GenerateAgentOutput> {
  const client = await createLLMClient(input.provider, input.model);
  const existingSkills = await listSkills();
  const builtInTools = getBuiltinToolDefinitions();

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
    for (let i = 0; i < audit.createSkills.length; i++) {
      const needed = audit.createSkills[i]!;
      console.log(`  [${i + 1}/${audit.createSkills.length}] Generating "${needed.name}"...`);
      const bundle = await createSkillPlaybook(client, input.request, needed.name, needed.description, existingSkills);
      console.log('        ✓ Generated markdown playbook');
      const saved = await saveSkillBundle(bundle);
      created.push(saved);
      console.log(`        ✓ Saved to disk`);
    }
  } else {
    console.log(`\n✓ Step 2/3 — No new skills needed`);
  }

  console.log(`\n📋 Step 3/3 — Assembling agent session...\n`);

  const allSkills = await listSkills();
  const assignedSkillIds = Array.from(new Set([...audit.useSkillIds, ...created.map((skill) => skill.id)]));
  const assignedSkills = allSkills.filter((skill) => assignedSkillIds.includes(skill.id));

  const allRequiredParams = dedupeParams(
    assignedSkills.flatMap((skill) => skill.requiredParams),
  );

  const missingParams = await findMissingParams(allRequiredParams);
  const systemPrompt = await buildSystemPrompt(input.request, assignedSkills, builtInTools);

  const session: AgentSession = {
    id: randomUUID(),
    name: await generateSessionName(input.request),
    description: input.request,
    systemPrompt,
    skills: assignedSkillIds,
    provider: input.provider ?? '',
    model: input.model ?? '',
    status: 'ready',
    messages: [createMessage('system', systemPrompt)],
    checkpoints: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  return {
    session,
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

async function createSkillPlaybook(
  client: Awaited<ReturnType<typeof createLLMClient>>,
  request: string,
  skillName: string,
  description: string,
  existingSkills: Skill[],
): Promise<SkillBundle> {
  console.log('      • Calling LLM to generate markdown skill...');

  const response = await client.complete(
    [
      createMessage(
        'system',
        [
          '# Skill Generator',
          '',
          'Generate a powerful, reusable skill for autonomous agents.',
          'Skills encode domain expertise and integration workflows. They are NOT generic advice.',
          '',
          'Design principles:',
          '- **Service-integrated**: Connect to external platforms (Gmail, GitHub, Slack, Google Drive).',
          '- **Multi-step workflows**: Break complex tasks into clear phases with decision gates.',
          '- **Risk-aware**: Identify approval points, validation steps, and error recovery.',
          '- **Tool-integrated**: Reference built-in tools (http_request, terminal_command, read_file) for API calls and data handling.',
          '- **Reusable**: Design for multiple use cases within the domain, not one-off tasks.',
          '',
          'Structure your skill:',
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
          'Existing skills are included in the user message as `existingSkills`. Use that list as a reference to avoid generating a duplicate or overlapping skill.',
          '- If any existing skill already defines an equivalent required parameter, reuse that same parameter key in this skill as well (do not create duplicate credentials).',
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
          'Format requirements:',
          '- Return ONLY markdown, no commentary. Do not wrap in markdown fences (no ```).',
          '- First non-whitespace content MUST be YAML frontmatter delimited by exactly three hyphens (---).',
          '- End frontmatter with exactly three hyphens (---) and then body content.',
          '- Frontmatter MUST include: name, description. Optional: homepage, metadata.',
          '- Example (must follow this exact structure):',
          '  ---',
          '  name: <Skill Name>',
          '  description: <Concise skill description>',
          '  metadata (optional):',
          '    requires:',
          '      env: [EXAMPLE_PARAM]',
          '  ---',
          '  1. …',
          '- Body: practical workflow guide with clear phases and decision logic.',
        ].join('\n'),
      ),
      createMessage(
        'user',
        JSON.stringify({
          request,
          skillName,
          description,
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
    ],
    [],
    false,
  );
  const resolved = assertNonStreamingResponse(response);
  const rawMarkdown = resolved.text.trim();

  const skill = parseSkillMarkdown(rawMarkdown, { idHint: skillName });
  return { skill, markdown: rawMarkdown };
}

async function generateSessionName(request: string): Promise<string> {
  const first = request.trim().split(/[.?!\n]/)[0] ?? 'Agent Session';
  return first.length <= 70 ? first : `${first.slice(0, 67)}...`;
}

async function buildSystemPrompt(request: string, skills: Skill[], tools: ToolDefinition[]): Promise<string> {
  // CRITICAL INVARIANT: Skills are NEVER callable tools. They are reference material injected
  // into the system prompt for strategy and workflow guidance only. The tools array must contain
  // ONLY built-in tools (read_file, write_file, terminal_command, http_request, web_search).
  // Skills are loaded from the session's skills array and injected as narrative content.
  
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
    'You are an OpenForge agent.',
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
    '- Parameter placeholders (${PARAM_NAME}) are automatically resolved at runtime—do not modify them.',
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
