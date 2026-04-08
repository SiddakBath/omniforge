import { listSkills, saveSkillBundle } from './skill-store.js';
import { loadStarterSkillBundles } from './starter-skills.js';
import { listAgents } from './agent-store.js';
import { hasActiveScheduledTasks } from './scheduled-tasks.js';
import { getSchedulerServiceStatus, installSchedulerService } from './scheduler-service.js';

export async function bootstrapOmniForge(): Promise<void> {
  const existing = await listSkills();
  const existingIds = new Set(existing.map((skill) => skill.id));

  const starterBundles = await loadStarterSkillBundles();
  for (const bundle of starterBundles) {
    if (!existingIds.has(bundle.skill.id)) {
      await saveSkillBundle(bundle);
    }
  }

  await ensureSchedulerAutoStartForExistingSchedules();
}

async function ensureSchedulerAutoStartForExistingSchedules(): Promise<void> {
  try {
    const agents = await listAgents();
    const hasEnabledSchedules = agents.some((agent) => agent.schedule?.enabled);
    const hasScheduledTasks = await hasActiveScheduledTasks();

    if (!hasEnabledSchedules && !hasScheduledTasks) {
      return;
    }

    const serviceStatus = await getSchedulerServiceStatus();
    if (!serviceStatus.installed) {
      await installSchedulerService();
    }
  } catch {
    // Best-effort only: scheduler auto-start setup failures should not block CLI usage.
  }
}
