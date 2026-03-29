import { executeBuiltinTool } from './builtin-tools.js';
import type { ToolCall, ToolExecutionResult, ToolExecutor } from './types.js';

interface ExecutorContext {
  provider?: string | undefined;
  model?: string | undefined;
  apiKey?: string | undefined;
  baseUrl?: string | undefined;
}

export class DefaultToolExecutor implements ToolExecutor {
  constructor(
    private readonly workspaceRoot = process.cwd(),
    private readonly _context: ExecutorContext = {},
  ) {}

  async execute(call: ToolCall): Promise<ToolExecutionResult> {
    const builtInResult = await executeBuiltinTool(call, {
      workspaceRoot: this.workspaceRoot,
    });

    if (builtInResult) {
      return builtInResult;
    }

    return {
      ok: false,
      output: `Unknown tool: ${call.name}. This runtime only executes built-in capabilities.`,
    };
  }
}
