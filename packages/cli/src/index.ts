#!/usr/bin/env node
import { Command } from 'commander';
import { bootstrapOpenForge } from '@openforge/core';
import { runCreateAgentCommand } from './commands/create-agent.js';
import { runOnboardingCommand } from './commands/onboarding.js';
import { runSessionsCommand } from './commands/sessions.js';
import { runSkillsCommand } from './commands/skills.js';
import { runSettingsCommand } from './commands/settings.js';
import { runResetCommand } from './commands/reset.js';
import { runWebCommand } from './commands/web.js';

const program = new Command();

program
  .name('openforge')
  .description('OpenForge CLI')
  .version('0.1.0');

program.hook('preAction', async () => {
  await bootstrapOpenForge();
});

program.command('onboard').description('Run first-time provider/model onboarding').action(runOnboardingCommand);

program
  .command('create')
  .description('Create a new agent from a natural-language description')
  .argument('[request...]', 'Agent request in plain language')
  .action(async (requestParts: string[]) => {
    await runCreateAgentCommand(requestParts.join(' ').trim());
  });

program.command('sessions').description('List resumable sessions').action(runSessionsCommand);
program.command('skills').description('Show skill library').action(runSkillsCommand);
program.command('settings').description('View generator/provider settings').action(runSettingsCommand);
program.command('reset').description('Reset OpenForge state (config, sessions, skills)').action(runResetCommand);
program.command('web').description('Run local web UI').action(runWebCommand);

program.parseAsync(process.argv).catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
