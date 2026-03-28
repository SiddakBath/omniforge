import { loadConfig } from '@openforge/core';
import { Box, render, Text } from 'ink';
import React from 'react';
import { Header, Section } from '../components/index.js';
import { displayBanner } from '../utils/banner.js';

function SettingsView({ config }: { config: any }) {
  return React.createElement(
    Box,
    { flexDirection: 'column', paddingX: 2, paddingY: 1 },
    React.createElement(Header, { title: 'Settings', subtitle: 'Manage your OpenForge configuration' }),
    React.createElement(
      Section,
      {
        title: 'Generator Configuration',
        children: React.createElement(
          React.Fragment,
          null,
          React.createElement(
            Text,
            null,
            'Default Provider: ',
            React.createElement(Text, { color: 'cyan', bold: true }, config.generator.provider || '(not set)')
          ),
          React.createElement(
            Text,
            null,
            'Default Model: ',
            React.createElement(Text, { color: 'cyan', bold: true }, config.generator.model || '(not set)')
          )
        ),
      }
    ),
    React.createElement(
      Section,
      {
        title: 'Configured Providers',
        children:
          Object.keys(config.providers).length > 0
            ? React.createElement(
                React.Fragment,
                null,
                Object.entries(config.providers).map(([providerId, providerConfig]: [string, any], i: number) => {
                  const redacted =
                    providerConfig.apiKey.length > 8
                      ? `${providerConfig.apiKey.slice(0, 4)}...${providerConfig.apiKey.slice(-4)}`
                      : '••••••••';
                  return React.createElement(Text, { key: i }, `• ${providerId}: ${redacted}`);
                })
              )
            : React.createElement(Text, null, 'No providers configured yet.'),
      }
    ),
    React.createElement(
      Box,
      { marginTop: 2 },
      React.createElement(Text, { color: 'gray' }, '💾 Configuration stored at ~/.openforge/config.json')
    )
  );
}

export async function runSettingsCommand(): Promise<void> {
  console.clear?.();
  displayBanner();

  const config = await loadConfig();

  render(React.createElement(SettingsView, { config }));

  await new Promise(() => {});
}
