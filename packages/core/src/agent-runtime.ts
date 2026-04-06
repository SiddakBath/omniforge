import { randomUUID } from 'crypto';
import { assertNonStreamingResponse } from './llm.js';
import { checkpointAgent, loadAgentSystemPrompt, saveAgent } from './agent-store.js';
import type { Agent, LLMClient, Message, ToolDefinition, ToolExecutor, ToolCall, ToolExecutionResult } from './types.js';

const DEFAULT_MAX_CONTEXT_MESSAGES = 60;

export interface RunTurnOptions {
  agent: Agent;
  userInput?: string;
  client: LLMClient;
  toolExecutor: ToolExecutor;
  tools: ToolDefinition[];
  onTextDelta?: (delta: string) => void;
  onToolCall?: (toolCall: ToolCall) => void;
  onToolCallConfirm?: (toolCall: ToolCall) => Promise<boolean>;
  onToolResult?: (toolCall: ToolCall, result: ToolExecutionResult) => void;
}

export async function runAgentTurn(options: RunTurnOptions): Promise<Agent> {
  let agent: Agent = {
    ...options.agent,
    status: 'running',
    messages: truncateHistory(options.agent.messages),
  };
  const systemPrompt = await loadAgentSystemPrompt(agent.id);

  if (options.userInput) {
    agent.messages = pushAndTruncate(agent.messages, createMessage('user', options.userInput));
  } else {
    const hasConversationalMessage = agent.messages.length > 0;
    if (!hasConversationalMessage) {
      agent.messages = pushAndTruncate(
        agent.messages,
        createMessage(
          'user',
          'Begin working on the goal from the system prompt. First provide a concise plan, then take the first action.',
        ),
      );
    }
  }

  while (true) {
    const response = await options.client.complete(buildContextMessages(systemPrompt, agent.messages), options.tools, false);
    const resolved = assertNonStreamingResponse(response);

    if (resolved.text.trim()) {
      agent.messages = pushAndTruncate(agent.messages, createMessage('assistant', resolved.text));
      options.onTextDelta?.(resolved.text);
    }

    if (resolved.toolCalls.length === 0) {
      agent.status = 'ready';
      agent = checkpointAgent(agent);
      await saveAgent(agent);
      return agent;
    }

    for (const toolCall of resolved.toolCalls) {
      options.onToolCall?.(toolCall);
      let executionResult: ToolExecutionResult;

      const approved = options.onToolCallConfirm ? await options.onToolCallConfirm(toolCall) : true;
      if (!approved) {
        executionResult = {
          ok: false,
          output: 'Tool execution canceled by user approval.',
        };
      } else {
        executionResult = await options.toolExecutor.execute(toolCall);
      }

      options.onToolResult?.(toolCall, executionResult);
      const content = JSON.stringify({ ok: executionResult.ok, output: executionResult.output });
      const toolMessage: Message = {
        id: randomUUID(),
        role: 'tool',
        name: toolCall.name,
        toolCallId: toolCall.id,
        content,
        createdAt: new Date().toISOString(),
      };
      agent.messages = pushAndTruncate(agent.messages, toolMessage);
    }
  }
}

function buildContextMessages(systemPrompt: string, history: Message[]): Message[] {
  return [createMessage('system', systemPrompt), ...truncateHistory(history)];
}

function pushAndTruncate(history: Message[], message: Message): Message[] {
  return truncateHistory([...history, message]);
}

function truncateHistory(history: Message[]): Message[] {
  const maxMessages = resolveMaxContextMessages();
  const nonSystem = history.filter((message) => message.role !== 'system');
  return nonSystem.slice(-maxMessages);
}

function resolveMaxContextMessages(): number {
  const parsed = Number(process.env.OPENFORGE_MAX_CONTEXT_MESSAGES ?? DEFAULT_MAX_CONTEXT_MESSAGES);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return DEFAULT_MAX_CONTEXT_MESSAGES;
  }
  return Math.floor(parsed);
}

export function createMessage(role: Message['role'], content: string): Message {
  return {
    id: randomUUID(),
    role,
    content,
    createdAt: new Date().toISOString(),
  };
}
