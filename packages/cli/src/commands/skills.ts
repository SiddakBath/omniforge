import * as readline from 'readline';
import { bootstrapOpenForge, listSkills } from '@openforge/core';
import { Box, render, Text } from 'ink';
import React, { useState, useEffect } from 'react';
import { Header, Section, ListItem } from '../components/index.js';
import { displayBanner } from '../utils/banner.js';

function SkillViewer({ skills }: { skills: any[] }) {
  const [selected, setSelected] = useState(0);

  useEffect(() => {
    const handleKeyPress = (buffer: any, key: any) => {
      if (key && key.ctrl && key.name === 'c') {
        process.exit(0);
      }
      if (key && key.name === 'up') {
        setSelected((s) => (s > 0 ? s - 1 : skills.length - 1));
      }
      if (key && key.name === 'down') {
        setSelected((s) => (s < skills.length - 1 ? s + 1 : 0));
      }
    };

    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.on('keypress', handleKeyPress);

    return () => {
      process.stdin.off('keypress', handleKeyPress);
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
    };
  }, [skills]);

  const currentSkill = skills[selected];

  return React.createElement(
    Box,
    { flexDirection: 'column', paddingX: 2, paddingY: 1 },
    React.createElement(Header, { title: 'Skill Library', subtitle: `${skills.length} skills available` }),
    React.createElement(
      Section,
      {
        title: 'All Skills',
        children: skills.map((skill, i) =>
          React.createElement(ListItem, {
            key: i,
            item: skill.name,
            selected: i === selected,
            description: skill.description,
          })
        ),
      }
    ),
    currentSkill
      ? React.createElement(
          Section,
          {
            title: `${currentSkill.name} Details`,
            children: React.createElement(
              React.Fragment,
              null,
              React.createElement(Text, null, 'Description: ', currentSkill.description),
              currentSkill.requiredParams && currentSkill.requiredParams.length > 0
                ? React.createElement(
                    React.Fragment,
                    null,
                    React.createElement(
                      Box,
                      { marginTop: 1 },
                      React.createElement(Text, null, 'Required Parameters:')
                    ),
                    currentSkill.requiredParams.map((param: any, i: number) =>
                      React.createElement(
                        Box,
                        { key: i, marginLeft: 2 },
                        React.createElement(Text, null, `• ${param.key}: ${param.description}`)
                      )
                    )
                  )
                : null,
              currentSkill.requiredBins && currentSkill.requiredBins.length > 0
                ? React.createElement(
                    React.Fragment,
                    null,
                    React.createElement(
                      Box,
                      { marginTop: 1 },
                      React.createElement(Text, null, 'Required Binaries:')
                    ),
                    currentSkill.requiredBins.map((bin: string, i: number) =>
                      React.createElement(
                        Box,
                        { key: i, marginLeft: 2 },
                        React.createElement(Text, null, `• ${bin}`)
                      )
                    )
                  )
                : null
            ),
          }
        )
      : null,
    React.createElement(
      Box,
      { marginTop: 2 },
      React.createElement(Text, { color: 'gray' }, '↑↓ Navigate • Ctrl+C to exit')
    )
  );
}

export async function runSkillsCommand(): Promise<void> {
  console.clear?.();
  displayBanner();
  const skills = await listSkills();

  if (skills.length === 0) {
    const EmptyView = () =>
      React.createElement(
        Box,
        { flexDirection: 'column', paddingX: 2, paddingY: 1 },
        React.createElement(Header, { title: 'Skill Library' }),
        React.createElement(Text, null, 'No skills available yet.')
      );

    render(React.createElement(EmptyView));
    return;
  }

  render(React.createElement(SkillViewer, { skills }));

  // Keep the process running
  await new Promise(() => {});
}
