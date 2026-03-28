import {
  createLLMClient,
  DefaultToolExecutor,
  listSessions,
  listSkills,
  loadConfig,
  loadSession,
  runAgentTurn,
  findMissingParams,
  saveParamValue,
} from '@openforge/core';
import { Box, render, Text } from 'ink';
import React from 'react';
import { Header, Section, Spinner, StatusBox } from '../components/index.js';
import { selectFromList, promptInput, promptPassword } from '../utils/interactive.js';
import { displayBanner } from '../utils/banner.js';

function StreamingOutput({ text, isRunning }: { text: string; isRunning: boolean }) {
  const lines = text.split('\n');
  return React.createElement(
    Box,
    { flexDirection: 'column' },
    isRunning
      ? React.createElement(
          Box,
          { marginBottom: 1 },
          React.createElement(Spinner, { text: 'Agent is responding...' })
        )
      : null,
    React.createElement(
      Section,
      {
        title: 'Agent Response',
        children: lines.map((line, i) => React.createElement(Text, { key: i, color: 'white' }, line || ' ')),
      }
    )
  );
}

export async function runSessionsCommand(): Promise<void> {
  console.clear?.();
  displayBanner();
  const sessions = await listSessions();

  if (sessions.length === 0) {
    const EmptyView = () =>
      React.createElement(
        Box,
        { flexDirection: 'column', paddingX: 2, paddingY: 1 },
        React.createElement(Header, { title: 'Sessions' }),
        React.createElement(
          Section,
          {
            title: 'No Sessions Yet',
            children: React.createElement(
              Text,
              null,
              'Create your first agent with: openforge create'
            ),
          }
        )
      );

    render(React.createElement(EmptyView));
    return;
  }

  const chosen = await selectFromList(
    'Select a session to resume',
    sessions.map((session) => ({
      label: session.name,
      value: session.id,
      description: `${session.provider}/${session.model} • Status: ${session.status}`,
    }))
  );

  const session = await loadSession(chosen);
  if (!session) {
    const ErrorView = () =>
      React.createElement(
        Box,
        { flexDirection: 'column', paddingX: 2, paddingY: 1 },
        React.createElement(StatusBox, { status: 'error', message: 'Session not found' })
      );
    render(React.createElement(ErrorView));
    process.exit(1);
  }

  console.clear?.();

  const SessionView = () =>
    React.createElement(
      Box,
      { flexDirection: 'column', paddingX: 2, paddingY: 1 },
      React.createElement(Header, { title: 'Resume Session', subtitle: session.name }),
      React.createElement(
        Section,
        {
          title: 'Session Info',
          children: React.createElement(
            React.Fragment,
            null,
            React.createElement(Text, null, 'Provider: ', session.provider),
            React.createElement(Text, null, 'Model: ', session.model),
            React.createElement(Text, null, 'Status: ', session.status)
          ),
        }
      )
    );

  render(React.createElement(SessionView));
  await new Promise((resolve) => setTimeout(resolve, 500));

  const userMessage = await promptInput('\n💬 Message to agent');

  if (!userMessage.trim()) {
    process.exit(0);
  }

  const assignedSkills = await listSkills();
  const activeSkills = assignedSkills.filter((skill) => session.skills.includes(skill.id));
  const tools = activeSkills.flatMap((skill) => skill.tools);

  const requiredParams = activeSkills.flatMap((skill) => skill.requiredParams);
  const missingParams = await findMissingParams(requiredParams);

  if (missingParams.length > 0) {
    console.log('\n⚙️  Session requires additional parameters before running:');
    missingParams.forEach((param) => {
      console.log(`  • ${param.label}${param.description ? ` - ${param.description}` : ''}`);
    });
    console.log('');

    for (const param of missingParams) {
      const value = param.secret
        ? await promptPassword(`🔐 ${param.label}`)
        : await promptInput(`📌 ${param.label}`);
      if (!value.trim()) {
        throw new Error(`${param.label} is required to continue.`);
      }
      await saveParamValue(param, value);
    }

    const remaining = await findMissingParams(requiredParams);
    if (remaining.length > 0) {
      throw new Error('Cannot run session: required parameters remain unsatisfied.');
    }

    console.log('\n✅ Required session parameters are satisfied.');
  }

  const client = await createLLMClient(session.provider, session.model);
  const config = await loadConfig();
  const executor = new DefaultToolExecutor(process.cwd(), {
    provider: session.provider,
    model: session.model,
    apiKey: config.providers[session.provider]?.apiKey,
  });

  console.clear?.();

  let streamed = '';
  const app = render(React.createElement(StreamingOutput, { text: streamed, isRunning: true }));

  const updated = await runAgentTurn({
    session,
    userInput: userMessage,
    client,
    toolExecutor: executor,
    tools,
    onTextDelta: (delta) => {
      streamed += delta;
      app.rerender(React.createElement(StreamingOutput, { text: streamed, isRunning: true }));
    },
  });

  app.unmount();

  console.clear?.();
  const SuccessView = () =>
    React.createElement(
      Box,
      { flexDirection: 'column', paddingX: 2, paddingY: 1 },
      React.createElement(StatusBox, { status: 'success', message: 'Message processed successfully' }),
      React.createElement(
        Section,
        {
          title: 'Session Updated',
          children: React.createElement(
            React.Fragment,
            null,
            React.createElement(Text, null, 'Session ID: ', updated.id),
            React.createElement(Text, null, 'Status: ', updated.status),
            React.createElement(Text, null, 'Use \'openforge sessions\' to continue.')
          ),
        }
      )
    );

  render(React.createElement(SuccessView));
}
