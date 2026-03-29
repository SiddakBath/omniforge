import { executeBuiltinTool } from './builtin-tools/registry.js';
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
    const builtinContext = {
      workspaceRoot: this.workspaceRoot,
      ...(this._context.provider ? { provider: this._context.provider } : {}),
      ...(this._context.model ? { model: this._context.model } : {}),
      ...(this._context.apiKey ? { apiKey: this._context.apiKey } : {}),
      ...(this._context.baseUrl ? { baseUrl: this._context.baseUrl } : {}),
    };

    const builtInResult = await executeBuiltinTool(call, builtinContext);

    if (builtInResult) {
      return builtInResult;
    }

    return {
      ok: false,
      output: `Unknown tool: ${call.name}. This runtime only executes built-in capabilities.`,
    };
  }
}
