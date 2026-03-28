import { readdir, readFile } from 'fs/promises';
import path from 'path';
import type { Skill, SkillBundle } from './types.js';

const STARTER_SKILL_CONFIG = 'skill.json';

function normalizeSkill(skill: Skill): Skill {
  return {
    ...skill,
    codeFile: (skill.codeFile || 'index.ts').replace(/\\/g, '/'),
  };
}

async function loadBundleFromDir(skillDir: string): Promise<SkillBundle | undefined> {
  const configPath = path.join(skillDir, STARTER_SKILL_CONFIG);
  try {
    const raw = await readFile(configPath, 'utf8');
    const parsed = JSON.parse(raw) as Skill;
    const skill = normalizeSkill(parsed);
    const codePath = path.resolve(skillDir, skill.codeFile);
    const code = await readFile(codePath, 'utf8');
    return { skill, code };
  } catch {
    return undefined;
  }
}

function fallbackBundle(): SkillBundle {
  const now = new Date().toISOString();
  return {
    skill: {
      id: 'web-search',
      name: 'Web Search',
      description: 'Searches the web and returns ranked snippets.',
      instruction: 'Use this tool when you need fresh web information.',
      tools: [
        {
          name: 'web_search',
          description: 'Search the public web',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string' },
              limit: { type: 'number', default: 5 },
            },
            required: ['query'],
          },
        },
      ],
      requiredParams: [],
      codeFile: 'index.ts',
      createdAt: now,
    },
    code: [
      "export async function runTool(context) {",
      "  const query = String(context.input.query ?? '').trim();",
      "  if (!query) {",
      "    throw new Error('query is required');",
      '  }',
      "  return { message: `Starter fallback web search received query: ${query}` };",
      '}',
      '',
    ].join('\n'),
  };
}

export async function loadStarterSkillBundles(): Promise<SkillBundle[]> {
  const candidates = [
    process.env.OPENFORGE_STARTER_SKILLS_DIR,
    path.resolve(process.cwd(), 'skills', 'starter-skills'),
  ];

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    try {
      const entries = await readdir(candidate, { withFileTypes: true });
      const directories = entries.filter((entry) => entry.isDirectory());
      const bundles = await Promise.all(
        directories.map((entry) => loadBundleFromDir(path.join(candidate, entry.name))),
      );
      const resolved = bundles.filter((bundle): bundle is SkillBundle => Boolean(bundle));
      if (resolved.length > 0) {
        return resolved.sort((a, b) => a.skill.name.localeCompare(b.skill.name));
      }
    } catch {
      // fallback
    }
  }

  return [fallbackBundle()];
}

export async function loadStarterSkills(): Promise<Skill[]> {
  const bundles = await loadStarterSkillBundles();
  return bundles.map((bundle) => bundle.skill);
}
