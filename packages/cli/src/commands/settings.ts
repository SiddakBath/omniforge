import { loadConfig } from '../core/index.js';
import { Box, render, Text } from 'ink';
import React from 'react';
import { Header, Section } from '../components/index.js';
import { displayBanner } from '../utils/banner.js';

function SettingsView({ config }: { config: any }) {
  return React.createElement(
    Box,
    { flexDirection: 'column', paddingX: 2, paddingY: 1 },
    React.createElement(Header, { title: 'Settings', subtitle: 'Manage your OmniForge configuration' }),
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
      Section,
      {
        title: 'Web Search',
        children: React.createElement(
          React.Fragment,
          null,
          React.createElement(
            Text,
            null,
            'Enabled: ',
            React.createElement(Text, { color: config.webSearch?.enabled ? 'green' : 'yellow', bold: true },
              config.webSearch?.enabled ? 'yes' : 'no'
            )
          ),
          React.createElement(
            Text,
            null,
            'Provider: ',
            React.createElement(Text, { color: 'cyan', bold: true }, config.webSearch?.provider || '(not set)')
          ),
          React.createElement(
            Text,
            null,
            'Saved keys: ',
            React.createElement(
              Text,
              { color: 'cyan', bold: true },
              Object.keys(config.webSearch?.providers ?? {}).length
            )
          ),
          React.createElement(Text, { color: 'gray' }, 'Use "omniforge config" to update these settings.')
        ),
      }
    ),
    React.createElement(
      Box,
      { marginTop: 2 },
      React.createElement(Text, { color: 'gray' }, '💾 Configuration stored at ~/.omniforge/config.json')
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
