import type { ToolCall, ToolDefinition, ToolExecutionResult } from '../types.js';

export interface BuiltinToolContext {
  workspaceRoot: string;
  currentAgentId?: string;
  provider?: string;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  webSearch?: {
    enabled: boolean;
    provider?: string;
    providers: Record<string, { apiKey: string }>;
  };
}

export type BuiltinToolExecutor = (
  call: ToolCall,
  context: BuiltinToolContext,
) => Promise<ToolExecutionResult>;

export interface BuiltinToolSpec {
  definition: ToolDefinition;
  execute: BuiltinToolExecutor;
  aliases?: string[];
}
