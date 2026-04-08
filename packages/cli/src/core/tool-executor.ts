import { executeBuiltinTool } from './builtin-tools/registry.js';
import { resolveParamValue } from './params-store.js';
import type { ToolCall, ToolExecutionResult, ToolExecutor } from './types.js';

interface ExecutorContext {
  currentAgentId?: string | undefined;
  provider?: string | undefined;
  model?: string | undefined;
  apiKey?: string | undefined;
  baseUrl?: string | undefined;
  webSearch?: {
    enabled: boolean;
    provider?: string;
    providers: Record<string, { apiKey: string }>;
  };
}

export class DefaultToolExecutor implements ToolExecutor {
  constructor(
    private readonly workspaceRoot = process.cwd(),
    private readonly _context: ExecutorContext = {},
  ) {}

  async execute(call: ToolCall): Promise<ToolExecutionResult> {
    const builtinContext = {
      workspaceRoot: this.workspaceRoot,
      ...(this._context.currentAgentId ? { currentAgentId: this._context.currentAgentId } : {}),
      ...(this._context.provider ? { provider: this._context.provider } : {}),
      ...(this._context.model ? { model: this._context.model } : {}),
      ...(this._context.apiKey ? { apiKey: this._context.apiKey } : {}),
      ...(this._context.baseUrl ? { baseUrl: this._context.baseUrl } : {}),
      ...(this._context.webSearch ? { webSearch: this._context.webSearch } : {}),
    };

    // Resolve parameter placeholders in tool call input before execution
    const resolvedCall = await this.resolveParameters(call);

    const builtInResult = await executeBuiltinTool(resolvedCall, builtinContext);

    if (builtInResult) {
      return builtInResult;
    }

    return {
      ok: false,
      output: `Unknown tool: ${call.name}. This runtime only executes built-in capabilities.`,
    };
  }

  /**
   * Recursively resolve parameter placeholders (${PARAM_NAME}) in tool call input
   * by fetching values from the params store.
   */
  private async resolveParameters(call: ToolCall): Promise<ToolCall> {
    const resolvedInput = await this.resolveValue(call.input);
    return {
      ...call,
      input: resolvedInput as Record<string, unknown>,
    };
  }

  /**
   * Recursively resolve parameter placeholders in any value (string, object, array, etc.)
   */
  private async resolveValue(value: unknown): Promise<unknown> {
    if (typeof value === 'string') {
      return this.resolveString(value);
    }
    if (Array.isArray(value)) {
      return Promise.all(value.map((item) => this.resolveValue(item)));
    }
    if (typeof value === 'object' && value !== null) {
      const resolved: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(value)) {
        resolved[key] = await this.resolveValue(val);
      }
      return resolved;
    }
    return value;
  }


  /**
   * Resolve parameter placeholders in a string.
   * Replaces ${PARAM_NAME} with the resolved param value from the params store.
   */
  private async resolveString(str: string): Promise<string> {
    const paramPattern = /\$\{([A-Z][A-Z0-9_]*)\}/g;
    let result = str;
    let match: RegExpExecArray | null;

    // eslint-disable-next-line no-cond-assign
    while ((match = paramPattern.exec(str)) !== null) {
      const paramKey = match[1]!;
      const paramValue = await resolveParamValue(paramKey);
      if (paramValue !== undefined) {
        result = result.replace(match[0], paramValue);
      }
    }

    return result;
  }
}
