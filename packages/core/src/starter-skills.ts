import { readdir, readFile } from 'fs/promises';
import path from 'path';
import { parseSkillMarkdown } from './skill-markdown.js';
import type { Skill, SkillBundle } from './types.js';

const SKILL_MARKDOWN_FILE = 'SKILL.md';

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

export async function loadStarterSkillBundles(): Promise<SkillBundle[]> {
  const candidates = [
    process.env.OPENFORGE_STARTER_SKILLS_DIR,
    path.resolve(process.cwd(), 'skills'),
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

  return [];
}

export async function loadStarterSkills(): Promise<Skill[]> {
  const bundles = await loadStarterSkillBundles();
  return bundles.map((bundle) => bundle.skill);
}
