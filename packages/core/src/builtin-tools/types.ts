import type { ToolCall, ToolDefinition, ToolExecutionResult } from '../types.js';

export interface BuiltinToolContext {
  workspaceRoot: string;
  provider?: string;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
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
