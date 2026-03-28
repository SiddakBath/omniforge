import { listSkills, saveSkillBundle } from './skill-store.js';
import { loadStarterSkillBundles } from './starter-skills.js';

export async function bootstrapOpenForge(): Promise<void> {
  const existing = await listSkills();
  const existingIds = new Set(existing.map((skill) => skill.id));

  const starterBundles = await loadStarterSkillBundles();
  for (const bundle of starterBundles) {
    if (!existingIds.has(bundle.skill.id)) {
      await saveSkillBundle(bundle);
    }
  }
}
