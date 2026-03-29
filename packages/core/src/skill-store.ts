import { execFile as execFileCallback } from 'child_process';
import { mkdir, readdir, readFile, writeFile } from 'fs/promises';
import { promisify } from 'util';
import path from 'path';
import { ensureOpenForgeDirs, OPENFORGE_SKILLS_DIR } from './paths.js';
import { parseSkillMarkdown, renderSkillMarkdown } from './skill-markdown.js';
import type { Skill, SkillBundle } from './types.js';

const execFile = promisify(execFileCallback);
const SKILL_MARKDOWN_FILE = 'SKILL.md';

export interface StoredSkillBundle {
  skill: Skill;
  skillDir: string;
  markdownPath: string;
  markdown: string;
}

function resolveSkillDir(skillId: string): string {
  return path.join(OPENFORGE_SKILLS_DIR, skillId);
}

async function listSkillDirectories(): Promise<string[]> {
  const entries = await readdir(OPENFORGE_SKILLS_DIR, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => path.join(OPENFORGE_SKILLS_DIR, entry.name));
}

async function loadStoredBundle(skillDir: string): Promise<StoredSkillBundle | undefined> {
  const markdownPath = path.join(skillDir, SKILL_MARKDOWN_FILE);
  try {
    const markdown = await readFile(markdownPath, 'utf8');
    const skill = parseSkillMarkdown(markdown, { idHint: path.basename(skillDir) });
    return {
      skill,
      skillDir,
      markdownPath,
      markdown,
    };
  } catch {
    return undefined;
  }
}

export async function listSkills(): Promise<Skill[]> {
  await ensureOpenForgeDirs();
  const directories = await listSkillDirectories();
  const bundles = await Promise.all(directories.map((dir) => loadStoredBundle(dir)));
  const skills = bundles
    .filter((bundle): bundle is StoredSkillBundle => Boolean(bundle))
    .map((bundle) => bundle.skill);

  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

export async function listSkillBundles(): Promise<StoredSkillBundle[]> {
  await ensureOpenForgeDirs();
  const directories = await listSkillDirectories();
  const bundles = await Promise.all(directories.map((dir) => loadStoredBundle(dir)));
  return bundles
    .filter((bundle): bundle is StoredSkillBundle => Boolean(bundle))
    .sort((a, b) => a.skill.name.localeCompare(b.skill.name));
}

export async function getSkillBundle(skillId: string): Promise<StoredSkillBundle | undefined> {
  await ensureOpenForgeDirs();
  return loadStoredBundle(resolveSkillDir(skillId));
}

export async function saveSkillBundle(bundle: SkillBundle): Promise<Skill> {
  await ensureOpenForgeDirs();
  const skillId = bundle.skill.id.trim();
  if (!skillId) {
    throw new Error('Skill id is required.');
  }

  const skillDir = resolveSkillDir(skillId);
  await mkdir(skillDir, { recursive: true });

  const markdown =
    typeof bundle.markdown === 'string' && bundle.markdown.trim().length > 0
      ? bundle.markdown
      : renderSkillMarkdown(bundle.skill);

  const normalized = parseSkillMarkdown(markdown, {
    idHint: skillId,
    createdAt: bundle.skill.createdAt,
  });

  await writeFile(path.join(skillDir, SKILL_MARKDOWN_FILE), markdown.endsWith('\n') ? markdown : `${markdown}\n`, 'utf8');
  return normalized;
}

export async function saveSkill(skill: Skill): Promise<void> {
  await saveSkillBundle({ skill });
}

/**
 * Mapping of canonical binary names to fallback alternatives.
 * Used to handle common naming variations across platforms.
 */
const BINARY_ALIASES: Record<string, string[]> = {
  python: ['python3', 'python3.11', 'python3.10', 'python3.9'],
  python3: ['python'],
  node: ['nodejs'],
  nodejs: ['node'],
  npm: ['npm.cmd'],
  git: ['git.exe'],
};

async function isBinaryAvailable(bin: string): Promise<boolean> {
  const checker = process.platform === 'win32' ? 'where' : 'which';
  
  // Try the binary name as provided first
  try {
    await execFile(checker, [bin]);
    return true;
  } catch {
    // If not found, try common aliases
    const aliases = BINARY_ALIASES[bin] ?? [];
    for (const alias of aliases) {
      try {
        await execFile(checker, [alias]);
        return true;
      } catch {
        // Continue to next alias
      }
    }
    return false;
  }
}

export async function findMissingSkillBins(skills: Skill[]): Promise<Array<{ skillId: string; bin: string }>> {
  const uniqueBins = [...new Set(skills.flatMap((skill) => skill.requiredBins))];
  const checks = await Promise.all(uniqueBins.map(async (bin) => ({ bin, exists: await isBinaryAvailable(bin) })));
  const missingBins = new Set(checks.filter((entry) => !entry.exists).map((entry) => entry.bin));

  const missing: Array<{ skillId: string; bin: string }> = [];
  for (const skill of skills) {
    for (const bin of skill.requiredBins) {
      if (missingBins.has(bin)) {
        missing.push({ skillId: skill.id, bin });
      }
    }
  }

  return missing;
}
