import { rm } from 'fs/promises';
import path from 'path';
import { Box, render, Text } from 'ink';
import React from 'react';
import {
  OMNIFORGE_HOME,
  OMNIFORGE_CONFIG_FILE,
  OMNIFORGE_PARAMS_FILE,
  OMNIFORGE_SKILLS_DIR,
} from '../core/index.js';
import { Header, StatusBox } from '../components/index.js';
import { promptConfirm } from '../utils/interactive.js';
import { displayBanner } from '../utils/banner.js';

export async function runResetCommand(): Promise<void> {
  console.clear?.();
  displayBanner();
  const agentsDir = path.join(OMNIFORGE_HOME, 'agents');

  const willReset = await promptConfirm(
    'This will delete all configuration, agents, params, and skills. Continue?'
  );

  if (!willReset) {
    const CancelView = () =>
      React.createElement(
        Box,
        { flexDirection: 'column', paddingX: 2, paddingY: 1 },
        React.createElement(StatusBox, {
          status: 'info',
          message: 'Reset canceled. No changes were made.',
        })
      );

    render(React.createElement(CancelView));
    return;
  }

  const removing = React.createElement(
    Box,
    { flexDirection: 'column', paddingX: 2, paddingY: 1 },
    React.createElement(Header, { title: 'Resetting OmniForge...' }),
    React.createElement(Text, null, 'Deleting configuration files and agents...')
  );
  const app = render(removing);

  await Promise.all([
    rm(OMNIFORGE_CONFIG_FILE, { force: true }),
    rm(OMNIFORGE_PARAMS_FILE, { force: true }),
    rm(agentsDir, { recursive: true, force: true }),
    rm(OMNIFORGE_SKILLS_DIR, { recursive: true, force: true }),
  ]);

  app.unmount();

  const DoneView = () =>
    React.createElement(
      Box,
      { flexDirection: 'column', paddingX: 2, paddingY: 1 },
      React.createElement(StatusBox, {
        status: 'success',
        message: 'OmniForge has been reset successfully.',
      }),
      React.createElement(Text, null, 'Run `omniforge onboard` to reconfigure the CLI.')
    );

  render(React.createElement(DoneView));
}
