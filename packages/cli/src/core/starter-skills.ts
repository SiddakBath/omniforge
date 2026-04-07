import { readdir, readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import path from 'path';
import { parseSkillMarkdown } from './skill-markdown.js';
import type { Skill, SkillBundle } from './types.js';

const SKILL_MARKDOWN_FILE = 'SKILL.md';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function loadBundleFromDir(skillDir: string): Promise<SkillBundle | undefined> {
  const markdownPath = path.join(skillDir, SKILL_MARKDOWN_FILE);
  try {
    const markdown = await readFile(markdownPath, 'utf8');
    const skill = parseSkillMarkdown(markdown, { idHint: path.basename(skillDir) });
    return { skill, markdown };
  } catch {
    return undefined;
  }
}

async function loadFromDirectory(skillsDir: string): Promise<SkillBundle[]> {
  try {
    const entries = await readdir(skillsDir, { withFileTypes: true });
    const directories = entries.filter((entry) => entry.isDirectory());
    const bundles = await Promise.all(
      directories.map((entry) => loadBundleFromDir(path.join(skillsDir, entry.name))),
    );
    const resolved = bundles.filter((bundle): bundle is SkillBundle => Boolean(bundle));
    return resolved.sort((a, b) => a.skill.name.localeCompare(b.skill.name));
  } catch {
    return [];
  }
}

export async function loadStarterSkillBundles(): Promise<SkillBundle[]> {
  // Environment variable takes precedence for custom skill locations
  if (process.env.OMNIFORGE_STARTER_SKILLS_DIR) {
    const bundles = await loadFromDirectory(process.env.OMNIFORGE_STARTER_SKILLS_DIR);
    if (bundles.length > 0) {
      return bundles;
    }
  }

  // Resolve skills directory relative to this file's location (works regardless of cwd)
  // __dirname is packages/cli/src/core, skills folder is at the repository root
  const skillsDir = path.resolve(__dirname, '..', '..', '..', 'skills');
  
  return loadFromDirectory(skillsDir);
}

export async function loadStarterSkills(): Promise<Skill[]> {
  const bundles = await loadStarterSkillBundles();
  return bundles.map((bundle) => bundle.skill);
}
