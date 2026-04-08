import type { ToolCall, ToolDefinition, ToolExecutionResult } from '../types.js';
import { applyPatchTool } from './apply-patch.js';
import { httpRequestTool } from './http-request.js';
import { readFileTool } from './read-file.js';
import { scheduleTool } from './schedule.js';
import { terminalCommandTool } from './terminal-command.js';
import type { BuiltinToolContext, BuiltinToolSpec } from './types.js';
import { webSearchTool } from './web-search.js';
import { writeFileTool } from './write-file.js';

const TOOL_SPECS: BuiltinToolSpec[] = [
  readFileTool,
  writeFileTool,
  applyPatchTool,
  terminalCommandTool,
  httpRequestTool,
  webSearchTool,
  scheduleTool,
];

const TOOL_BY_NAME = new Map<string, BuiltinToolSpec>();
for (const spec of TOOL_SPECS) {
  TOOL_BY_NAME.set(spec.definition.name, spec);
  for (const alias of spec.aliases ?? []) {
    TOOL_BY_NAME.set(alias, spec);
  }
}

export function getBuiltinToolDefinitions(): ToolDefinition[] {
  return TOOL_SPECS.map((spec) => spec.definition);
}

export async function executeBuiltinTool(
  call: ToolCall,
  context: BuiltinToolContext,
): Promise<ToolExecutionResult | undefined> {
  const spec = TOOL_BY_NAME.get(call.name);
  if (!spec) {
    return undefined;
  }
  return spec.execute(call, context);
}
