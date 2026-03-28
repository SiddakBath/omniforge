import { randomUUID } from 'crypto';
import { assertNonStreamingResponse } from './llm.js';
import { checkpointSession, saveSession } from './session-store.js';
import type { AgentSession, LLMClient, Message, ToolDefinition, ToolExecutor } from './types.js';

export interface RunTurnOptions {
  session: AgentSession;
  userInput?: string;
  client: LLMClient;
  toolExecutor: ToolExecutor;
  tools: ToolDefinition[];
  onTextDelta?: (delta: string) => void;
}

export async function runAgentTurn(options: RunTurnOptions): Promise<AgentSession> {
  let session: AgentSession = {
    ...options.session,
    status: 'running',
  };

  if (options.userInput) {
    session.messages.push(createMessage('user', options.userInput));
  } else {
    const hasConversationalMessage = session.messages.some((message) => message.role !== 'system');
    if (!hasConversationalMessage) {
      session.messages.push(
        createMessage(
          'user',
          'Begin working on the goal from the system prompt. First provide a concise plan, then take the first action.',
        ),
      );
    }
  }

  while (true) {
    const response = await options.client.complete(session.messages, options.tools, false);
    const resolved = assertNonStreamingResponse(response);

    if (resolved.text.trim()) {
      session.messages.push(createMessage('assistant', resolved.text));
      options.onTextDelta?.(resolved.text);
    }

    if (resolved.toolCalls.length === 0) {
      session.status = 'ready';
      session = checkpointSession(session);
      await saveSession(session);
      return session;
    }

    for (const toolCall of resolved.toolCalls) {
      const result = await options.toolExecutor.execute(toolCall);
      const content = JSON.stringify({ ok: result.ok, output: result.output });
      const toolMessage: Message = {
        id: randomUUID(),
        role: 'tool',
        name: toolCall.name,
        toolCallId: toolCall.id,
        content,
        createdAt: new Date().toISOString(),
      };
      session.messages.push(toolMessage);
    }
  }
}

export function createMessage(role: Message['role'], content: string): Message {
  return {
    id: randomUUID(),
    role,
    content,
    createdAt: new Date().toISOString(),
  };
}
