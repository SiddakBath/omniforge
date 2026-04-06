import { rm } from 'fs/promises';
import path from 'path';
import { Box, render, Text } from 'ink';
import React from 'react';
import {
  OPENFORGE_HOME,
  OPENFORGE_CONFIG_FILE,
  OPENFORGE_PARAMS_FILE,
  OPENFORGE_SKILLS_DIR,
} from '@openforge/core';
import { Header, StatusBox } from '../components/index.js';
import { promptConfirm } from '../utils/interactive.js';
import { displayBanner } from '../utils/banner.js';

export async function runResetCommand(): Promise<void> {
  console.clear?.();
  displayBanner();
  const agentsDir = path.join(OPENFORGE_HOME, 'agents');

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
    React.createElement(Header, { title: 'Resetting OpenForge...' }),
    React.createElement(Text, null, 'Deleting configuration files and agents...')
  );
  const app = render(removing);

  await Promise.all([
    rm(OPENFORGE_CONFIG_FILE, { force: true }),
    rm(OPENFORGE_PARAMS_FILE, { force: true }),
    rm(agentsDir, { recursive: true, force: true }),
    rm(OPENFORGE_SKILLS_DIR, { recursive: true, force: true }),
  ]);

  app.unmount();

  const DoneView = () =>
    React.createElement(
      Box,
      { flexDirection: 'column', paddingX: 2, paddingY: 1 },
      React.createElement(StatusBox, {
        status: 'success',
        message: 'OpenForge has been reset successfully.',
      }),
      React.createElement(Text, null, 'Run `openforge onboard` to reconfigure the CLI.')
    );

  render(React.createElement(DoneView));
}
