import { mkdir, readdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import { ensureOpenForgeDirs, OPENFORGE_SKILLS_DIR } from './paths.js';
import type { Skill, SkillBundle } from './types.js';

const SKILL_CONFIG_FILE = 'skill.json';
const DEFAULT_CODE_FILE = 'index.ts';

export interface StoredSkillBundle {
  skill: Skill;
  skillDir: string;
  configPath: string;
  codePath: string;
}

function resolveSkillDir(skillId: string): string {
  return path.join(OPENFORGE_SKILLS_DIR, skillId);
}

function normalizeCodeFile(codeFile: string | undefined): string {
  const trimmed = (codeFile ?? '').trim();
  if (!trimmed) {
    return DEFAULT_CODE_FILE;
  }
  if (path.isAbsolute(trimmed)) {
    throw new Error('Skill codeFile must be relative to the skill directory.');
  }
  return trimmed.replace(/\\/g, '/');
}

function normalizeSkill(skill: Skill): Skill {
  return {
    ...skill,
    codeFile: normalizeCodeFile(skill.codeFile),
  };
}

function getCodePath(skillDir: string, skill: Skill): string {
  const resolvedCodePath = path.resolve(skillDir, skill.codeFile);
  const normalizedSkillDir = path.resolve(skillDir);
  if (!resolvedCodePath.startsWith(normalizedSkillDir)) {
    throw new Error(`Skill codeFile escapes skill directory: ${skill.codeFile}`);
  }
  return resolvedCodePath;
}

async function readSkillConfig(configPath: string): Promise<Skill | undefined> {
  try {
    const raw = await readFile(configPath, 'utf8');
    const parsed = JSON.parse(raw) as Skill;
    return normalizeSkill(parsed);
  } catch {
    return undefined;
  }
}

async function writeSkillConfig(skillDir: string, skill: Skill): Promise<void> {
  const configPath = path.join(skillDir, SKILL_CONFIG_FILE);
  await writeFile(configPath, `${JSON.stringify(skill, null, 2)}\n`, 'utf8');
}

async function loadStoredBundle(skillDir: string): Promise<StoredSkillBundle | undefined> {
  const configPath = path.join(skillDir, SKILL_CONFIG_FILE);
  const skill = await readSkillConfig(configPath);
  if (!skill) {
    return undefined;
  }
  const codePath = getCodePath(skillDir, skill);
  return { skill, skillDir, configPath, codePath };
}

async function listSkillDirectories(): Promise<string[]> {
  const entries = await readdir(OPENFORGE_SKILLS_DIR, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => path.join(OPENFORGE_SKILLS_DIR, entry.name));
}

async function listLegacySkillFiles(): Promise<string[]> {
  const entries = await readdir(OPENFORGE_SKILLS_DIR, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => path.join(OPENFORGE_SKILLS_DIR, entry.name));
}

async function migrateLegacySkillFile(filePath: string): Promise<StoredSkillBundle | undefined> {
  try {
    const raw = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as Skill;
    const skill = normalizeSkill({
      ...parsed,
      codeFile: parsed.codeFile || DEFAULT_CODE_FILE,
    });

    const skillDir = resolveSkillDir(skill.id);
    await mkdir(skillDir, { recursive: true });
    const codePath = getCodePath(skillDir, skill);

    try {
      await readFile(codePath, 'utf8');
    } catch {
      const toolList = skill.tools.map((tool) => `'${tool.name}'`).join(', ');
      const scaffold = [
        "export async function runTool(context) {",
        "  const supported = new Set([" + toolList + "]);",
        "  if (!supported.has(context.toolName)) {",
        "    throw new Error(`Unsupported tool: ${context.toolName}`);",
        '  }',
        "  return {",
        "    ok: false,",
        "    message:",
        "      'This skill was migrated from legacy JSON format and needs runnable code in index.ts.',",
        '    input: context.input,',
        '  };',
        '}',
        '',
      ].join('\n');
      await writeFile(codePath, scaffold, 'utf8');
    }

    await writeSkillConfig(skillDir, skill);
    return { skill, skillDir, configPath: path.join(skillDir, SKILL_CONFIG_FILE), codePath };
  } catch {
    return undefined;
  }
}

async function ensureMigratedBundles(): Promise<StoredSkillBundle[]> {
  const directories = await listSkillDirectories();
  const bundles = await Promise.all(directories.map((dir) => loadStoredBundle(dir)));

  const migrated: StoredSkillBundle[] = bundles.filter((bundle): bundle is StoredSkillBundle => Boolean(bundle));
  if (migrated.length > 0) {
    return migrated;
  }

  const legacyFiles = await listLegacySkillFiles();
  const migratedLegacy = await Promise.all(legacyFiles.map((filePath) => migrateLegacySkillFile(filePath)));
  return migratedLegacy.filter((bundle): bundle is StoredSkillBundle => Boolean(bundle));
}

export async function listSkills(): Promise<Skill[]> {
  await ensureOpenForgeDirs();
  const bundles = await ensureMigratedBundles();
  const skills = bundles.map((bundle) => bundle.skill);

  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

export async function listSkillBundles(): Promise<StoredSkillBundle[]> {
  await ensureOpenForgeDirs();
  const bundles = await ensureMigratedBundles();
  return bundles.sort((a, b) => a.skill.name.localeCompare(b.skill.name));
}

export async function getSkillBundle(skillId: string): Promise<StoredSkillBundle | undefined> {
  await ensureOpenForgeDirs();
  const skillDir = resolveSkillDir(skillId);
  return loadStoredBundle(skillDir);
}

export async function findSkillBundleByToolName(toolName: string): Promise<StoredSkillBundle | undefined> {
  const bundles = await listSkillBundles();
  return bundles.find((bundle) => bundle.skill.tools.some((tool) => tool.name === toolName));
}

export async function saveSkillBundle(bundle: SkillBundle): Promise<Skill> {
  await ensureOpenForgeDirs();
  const normalized = normalizeSkill(bundle.skill);
  const skillDir = resolveSkillDir(normalized.id);
  await mkdir(skillDir, { recursive: true });

  const codePath = getCodePath(skillDir, normalized);
  await mkdir(path.dirname(codePath), { recursive: true });
  await writeFile(codePath, bundle.code, 'utf8');
  await writeSkillConfig(skillDir, normalized);

  return normalized;
}

export async function saveSkill(skill: Skill): Promise<void> {
  const existing = await getSkillBundle(skill.id);
  const code =
    existing?.codePath
      ? await readFile(existing.codePath, 'utf8').catch(() => defaultSkillCode(skill))
      : defaultSkillCode(skill);

  await saveSkillBundle({
    skill: {
      ...skill,
      codeFile: skill.codeFile || existing?.skill.codeFile || DEFAULT_CODE_FILE,
    },
    code,
  });
}

function defaultSkillCode(skill: Skill): string {
  const toolList = skill.tools.map((tool) => `'${tool.name}'`).join(', ');
  return [
    "export async function runTool(context) {",
    "  const supported = new Set([" + toolList + "]);",
    "  if (!supported.has(context.toolName)) {",
    "    throw new Error(`Unsupported tool: ${context.toolName}`);",
    '  }',
    "  throw new Error('Skill code has not been implemented yet.');",
    '}',
    '',
  ].join('\n');
}
