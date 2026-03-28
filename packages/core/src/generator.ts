import { randomUUID } from 'crypto';
import { z } from 'zod';
import { createMessage } from './agent-runtime.js';
import { createLLMClient } from './llm-factory.js';
import { assertNonStreamingResponse } from './llm.js';
import { findMissingParams } from './params-store.js';
import { listSkills, saveSkillBundle } from './skill-store.js';
import type { AgentSession, RequiredParam, Skill, SkillAuditResult, SkillBundle } from './types.js';

const SKILL_GENERATOR_SYSTEM_PROMPT = [
  '# OpenForge Skill Generator',
  'You are creating self-contained, powerful skills for autonomous AI agents to accomplish complex tasks.',
  '',
  '## What are Skills?',
  'Skills are composable plugin-style modules that extend agent capabilities. Each skill bundles:',
  '- Multiple tools (functions the agent can call)',
  '- Runnable code that implements those tools',
  '- Configuration describing parameters, required credentials, and tool definitions',
  'Skills are NOT simple utilities—they are powerful, production-grade orchestrators.',
  '',
  '## Skill Power Examples',
  'Skills should be sophisticated. Examples of powerful skills:',
  '- web-search: Routes queries through multiple providers (Brave API, Perplexity API, built-in LLM search), handles timeouts, freshness filters, provider routing, and citation tracking',
  '- file-io: Safely reads/writes files within workspace boundaries, creates parent directories automatically, validates paths',
  '- http-client: Executes requests with timeout handling, optional JSON parsing, structured error responses',
  '- shell-exec: Runs commands with timeout, captures stdout/stderr separately, provides structured diagnostics',
  'Create skills at this level of sophistication.',
  '',
  '## What Capabilities Should Skills Have?',
  '- Multi-tool orchestration: Single skill often provides multiple related tools (e.g., web-search tool with auto/api/builtin modes)',
  '- Provider awareness: Use runtime context (provider, model, API keys) to adapt behavior intelligently',
  '- Graceful degradation: Fall back gracefully when primary method fails (e.g., web-search tries Brave → Perplexity → built-in search → DuckDuckGo)',
  '- Production robustness: Timeout handling, validation, structured error messages, no silent failures',
  '- Domain expertise: Understand the domain deeply and implement best practices (freshness filters, citation extraction, safe paths, etc.)',
  '',
  '## Output Format (STRICT JSON ONLY)',
  'Return strict JSON only. No markdown fences, prose, or comments outside JSON.',
  'Output shape must be exactly: { config: SkillConfigJson, codeFile?: string, code: string }',
  'SkillConfigJson fields: id, name, description, instruction, tools, requiredParams, codeFile?',
  '',
  '## Runtime Contract (MUST follow exactly)',
  '- Tool execution is skill-only. No built-in core handlers exist—your code IS the implementation.',
  '- Code must be runnable TypeScript module code.',
  '- Export async function runTool(context) as the main entry point.',
  '- Context shape: { toolName, input, workspaceRoot, runtimeContext }',
  '- runtimeContext may contain { provider, model, apiKey, baseUrl }—use these for intelligent routing.',
  '- Route behavior by context.toolName and throw on unsupported tool names.',
  '- Return serializable JSON objects (prefer structured diagnostic objects over raw strings).',
  '',
  '## Tool Definition Requirements',
  '- Include complete JSON-schema-like parameters for every tool.',
  '- Provide precise required arrays for mandatory fields.',
  '- Include a `handler` string for each tool (default to `runTool` unless another exported function is used).',
  '- Tool names should be lowercase snake_case and unique within the skill.',
  '',
  '## Power and Robustness Requirements',
  '- Implement useful, production-style behavior (timeouts, validation, clear errors, structured outputs).',
  '- For network operations: support configurable timeout and meaningful error messages.',
  '- For filesystem operations: enforce safe workspace-root-constrained paths and create parent dirs.',
  '- For command execution: validate input, return stdout/stderr separately, provide exit codes.',
  '- Use graceful failures with actionable error messages—never silent failures.',
  '- Example: { ok: true, output: "..." } and { ok: false, error: "...", code: 1 }',
  '',
  '## Remember',
  'The autonomous agent using this skill will rely on it working perfectly. Your code is THE implementation—there is no fallback.',
  'Make it powerful, robust, and production-ready.',
].join('\n');

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

const SkillCreateSchema = z.object({
  config: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().min(1),
    instruction: z.string().min(1),
    tools: z.array(
      z.object({
        name: z.string().min(1),
        description: z.string().min(1),
        parameters: z.record(z.unknown()),
        handler: z.string().optional(),
      }),
    ),
    requiredParams: z.array(
      z.object({
        key: z.string(),
        label: z.string(),
        description: z.string(),
        secret: z.boolean(),
      }),
    ),
    codeFile: z.string().optional(),
  }),
  code: z.string(),
  codeFile: z.string().optional(),
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
      const bundle = await createSkill(client, input.request, needed.name, needed.description, existingSkills);
      console.log(`        ✓ Generated with ${bundle.skill.tools.length} tool(s)`);
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
  const systemPrompt = buildSystemPrompt(input.request, assignedSkills);

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
  const response = await client.complete(
    [
      createMessage(
        'system',
        [
          '# OpenForge Skill Auditor',
          'You are analyzing agent creation requests to determine what skills are needed.',
          '',
          '## Your Task',
          'Given a user request to create an autonomous AI agent, analyze:',
          '1. What capabilities the agent needs (reading files, calling APIs, searching the web, executing commands, etc.)',
          '2. Which existing skills can fulfill those capabilities',
          '3. Which new skills must be created to complete the agent',
          '',
          '## Understanding Skill Capabilities',
          'Each skill provides multiple tools that enable domain-specific functionality:',
          '- web-search: Query the internet with multiple provider options (Brave Search, Perplexity, built-in LLM search, DuckDuckGo fallback). Can filter by freshness, date range, and more.',
          '- file-io: Read and write files safely within workspace boundaries. Create parent directories automatically.',
          '- http-client: Execute HTTP requests with timeout handling, optional JSON parsing, custom headers, error handling.',
          '- shell-exec: Run system commands with timeout, capture stdout/stderr separately, return structured diagnostics.',
          'Existing skills may have more tools than listed here. Examine the full tool descriptions provided.',
          '',
          '## Guidelines for Decision Making',
          '- Prefer reusing existing skills over creating new ones',
          '- A single skill can be powerful and multi-faceted—do not fragment into many small skills',
          '- Be specific about which tools within a skill will be used in the request',
          '- If an existing skill is close but missing a specific tool, consider creating a new skill to extend capabilities',
          '- Recognize when capabilities genuinely require new skills (e.g., email sending, database interaction, payment processing)',
          '',
          '## Output Format (STRICT JSON ONLY)',
          'Return: { useSkillIds: [string], createSkills: [{ name: string, description: string }] }',
          'useSkillIds: Array of existing skill IDs to reuse',
          'createSkills: Array of new skills needed, with clear names and descriptions (these will be generated separately)',
          '',
          'Be pragmatic. The autonomous agent will depend on your audit to function correctly.',
        ].join('\n'),
      ),
      createMessage(
        'user',
        JSON.stringify({
          request,
          skills: skills.map((skill) => ({
            id: skill.id,
            name: skill.name,
            description: skill.description,
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
  if (result.success) {
    return result.data;
  }

  return {
    useSkillIds: skills.map((skill) => skill.id),
    createSkills: [],
  };
}

async function createSkill(
  client: Awaited<ReturnType<typeof createLLMClient>>,
  request: string,
  skillName: string,
  description: string,
  existingSkills: Skill[],
): Promise<SkillBundle> {
  console.log(`      • Calling LLM to generate skill code...`);
  const response = await client.complete(
    [
      createMessage('system', SKILL_GENERATOR_SYSTEM_PROMPT),
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
            tools: skill.tools.map((tool) => ({
              name: tool.name,
              description: tool.description,
            })),
          })),
        }),
      ),
    ],
    [],
    false,
  );
  const resolved = assertNonStreamingResponse(response);

  console.log(`      • Validating generated JSON...`);
  let parsed = SkillCreateSchema.safeParse(parseJsonSafely(resolved.text));
  if (!parsed.success) {
    console.log(`      • JSON validation failed, attempting repair...`);
    const repairResponse = await client.complete(
      [
        createMessage(
          'system',
          [
            'You are a JSON repair assistant for OpenForge skill generation.',
            'Convert the provided malformed output into valid strict JSON only.',
            'Do not omit required fields. Keep semantics and code intent.',
            'Output shape must be exactly: { config: SkillConfigJson, codeFile?: string, code: string }.',
          ].join('\n'),
        ),
        createMessage('user', resolved.text),
      ],
      [],
      false,
    );
    const repaired = assertNonStreamingResponse(repairResponse);
    parsed = SkillCreateSchema.safeParse(parseJsonSafely(repaired.text));
    if (parsed.success) {
      console.log(`      • ✓ JSON repair successful`);
    }
  } else {
    console.log(`      • ✓ JSON is valid`);
  }

  if (!parsed.success) {
    const id = slugify(skillName);
    const now = new Date().toISOString();
    const fallbackSkill: Skill = {
      id,
      name: skillName,
      description,
      instruction: `Use ${skillName} when its functionality is required.`,
      tools: [],
      requiredParams: [],
      codeFile: 'index.ts',
      createdAt: now,
    };

    const fallbackCode = [
      "export async function runTool(context) {",
      "  return {",
      "    ok: false,",
      "    message: 'Generated fallback skill has no implementation yet.',",
      "    toolName: context.toolName,",
      '    input: context.input,',
      '  };',
      '}',
      '',
    ].join('\n');

    return {
      skill: fallbackSkill,
      code: fallbackCode,
    };
  }

  const codeFile =
    (parsed.data.codeFile || parsed.data.config.codeFile || 'index.ts').trim() || 'index.ts';

  const normalizedTools = parsed.data.config.tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    ...(typeof tool.handler === 'string' && tool.handler.trim().length > 0
      ? { handler: tool.handler.trim() }
      : {}),
  }));

  const skill: Skill = {
    ...parsed.data.config,
    id: slugify(parsed.data.config.id || skillName),
    tools: normalizedTools,
    codeFile,
    createdAt: new Date().toISOString(),
  };

  return {
    skill,
    code: parsed.data.code,
  };
}

async function generateSessionName(request: string): Promise<string> {
  const first = request.trim().split(/[.?!\n]/)[0] ?? 'Agent Session';
  return first.length <= 70 ? first : `${first.slice(0, 67)}...`;
}

function buildSystemPrompt(request: string, skills: Skill[]): string {
  return [
    'You are an OpenForge agent.',
    `Goal: ${request}`,
    '',
    'Behavioral guidelines:',
    '- Act autonomously for clearly safe actions.',
    '- Ask the user for clarification when ambiguity changes outcomes.',
    '- Report progress in concise checkpoints.',
    '- If a tool fails, explain cause and next best action.',
    '',
    'Skill instructions:',
    ...skills.map((skill) => `[${skill.id}] ${skill.instruction}`),
  ].join('\n');
}

function parseJsonSafely(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (!match) {
      return {};
    }
    try {
      return JSON.parse(match[0]);
    } catch {
      return {};
    }
  }
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function dedupeParams(params: RequiredParam[]): RequiredParam[] {
  const map = new Map<string, RequiredParam>();
  for (const param of params) {
    map.set(param.key, param);
  }
  return [...map.values()];
}
