#!/usr/bin/env node
import { Command } from 'commander';
import { bootstrapOmniForge } from './core/index.js';
import { runCreateAgentCommand } from './commands/create-agent.js';
import { runOnboardingCommand } from './commands/onboarding.js';
import { runAgentsCommand } from './commands/agents.js';
import { runSchedulerCommand } from './commands/scheduler.js';
import { runSkillsCommand } from './commands/skills.js';
import { runSettingsCommand } from './commands/settings.js';
import { runResetCommand } from './commands/reset.js';

const program = new Command();

program
  .name('omniforge')
  .description('OmniForge CLI')
  .version('0.1.0');

program.hook('preAction', async () => {
  await bootstrapOmniForge();
});

program.command('onboard').description('Run first-time provider/model onboarding').action(runOnboardingCommand);
program.command('config').description('Update provider/model and web search configuration').action(runOnboardingCommand);

program
  .command('create')
  .description('Create a new agent from a natural-language description')
  .argument('[request...]', 'Agent request in plain language')
  .action(async (requestParts: string[]) => {
    await runCreateAgentCommand(requestParts.join(' ').trim());
  });

program.command('agents').description('List resumable agents').action(runAgentsCommand);
program.command('scheduler').alias('schedule').description('Run scheduled agents continuously').action(runSchedulerCommand);
program.command('skills').description('Show skill library').action(runSkillsCommand);
program.command('settings').description('View current OmniForge settings').action(runSettingsCommand);
program.command('reset').description('Reset OmniForge state (config, agents, skills)').action(runResetCommand);

program.parseAsync(process.argv).catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
