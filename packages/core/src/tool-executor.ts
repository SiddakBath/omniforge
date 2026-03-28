import { readFile } from 'fs/promises';
import path from 'path';
import { pathToFileURL } from 'url';
import { findSkillBundleByToolName } from './skill-store.js';
import type { ToolCall, ToolExecutionResult, ToolExecutor } from './types.js';

type DynamicToolContext = {
  toolName: string;
  input: Record<string, unknown>;
  workspaceRoot: string;
  runtimeContext: ExecutorContext;
};

type DynamicToolFn = (context: DynamicToolContext) => Promise<unknown> | unknown;

type DynamicToolModule = {
  default?: DynamicToolFn;
  runTool?: DynamicToolFn;
  [name: string]: unknown;
};

interface ExecutorContext {
  provider?: string | undefined;
  model?: string | undefined;
  apiKey?: string | undefined;
  baseUrl?: string | undefined;
}

export class DefaultToolExecutor implements ToolExecutor {
  constructor(
    private readonly workspaceRoot = process.cwd(),
    private readonly context: ExecutorContext = {},
  ) {}

  async execute(call: ToolCall): Promise<ToolExecutionResult> {
    const dynamicResult = await this.tryExecuteDynamicSkillTool(call);
    if (dynamicResult) {
      return dynamicResult;
    }

    return {
      ok: false,
      output:
        `Unknown tool: ${call.name}. Built-in tool handlers were removed; define this tool in a skill bundle under ~/.openforge/skills/<skill-id>/skill.json with runnable code.`,
    };
  }

  private async tryExecuteDynamicSkillTool(call: ToolCall): Promise<ToolExecutionResult | undefined> {
    const bundle = await findSkillBundleByToolName(call.name);
    if (!bundle) {
      return undefined;
    }

    try {
      const module = await loadSkillModule(bundle.codePath);
      const toolConfig = bundle.skill.tools.find((tool) => tool.name === call.name);
      const handlerName =
        typeof toolConfig?.handler === 'string' && toolConfig.handler.trim().length > 0
          ? toolConfig.handler.trim()
          : undefined;

      const runnable = resolveSkillRunnable(module, call.name, handlerName);
      const value = await runnable({
        toolName: call.name,
        input: call.input,
        workspaceRoot: this.workspaceRoot,
        runtimeContext: this.context,
      });

      if (typeof value === 'string') {
        return { ok: true, output: value };
      }

      return { ok: true, output: JSON.stringify(value ?? {}, null, 2) };
    } catch (error) {
      return {
        ok: false,
        output: `Skill tool ${call.name} failed: ${formatSkillToolError(error)}`,
      };
    }
  }
}
function formatSkillToolError(error: unknown): string {
  if (error instanceof Error) {
    const message = error.message.trim();
    if (message.length > 0) {
      return message;
    }
  }
  return 'Unknown skill execution error.';
}

async function loadSkillModule(codePath: string): Promise<DynamicToolModule> {
  const ext = path.extname(codePath).toLowerCase();
  if (ext === '.mjs' || ext === '.js' || ext === '.cjs') {
    const moduleUrl = `${pathToFileURL(codePath).href}?v=${Date.now()}`;
    return (await import(moduleUrl)) as DynamicToolModule;
  }

  if (ext !== '.ts' && ext !== '.mts' && ext !== '.cts') {
    throw new Error(`Unsupported skill code extension: ${ext}`);
  }

  const source = await readFile(codePath, 'utf8');
  let typescriptModule: unknown;
  try {
    typescriptModule = await import('typescript');
  } catch {
    throw new Error(
      'Cannot run TypeScript skill file because `typescript` is unavailable. Install it in the workspace or use .mjs skill code.',
    );
  }

  const ts = typescriptModule as {
    transpileModule: (
      sourceText: string,
      options: { compilerOptions: Record<string, unknown>; fileName?: string },
    ) => { outputText: string };
    ModuleKind: { ES2022: number };
    ScriptTarget: { ES2022: number };
  };

  const transpiled = ts.transpileModule(source, {
    fileName: codePath,
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      sourceMap: false,
      inlineSourceMap: false,
      esModuleInterop: true,
    },
  }).outputText;

  const encoded = Buffer.from(transpiled, 'utf8').toString('base64');
  const moduleUrl = `data:text/javascript;base64,${encoded}`;
  return (await import(moduleUrl)) as DynamicToolModule;
}

function normalizeExportedName(toolName: string): string {
  return toolName.replace(/[^a-zA-Z0-9_$]/g, '_');
}

function resolveSkillRunnable(
  module: DynamicToolModule,
  toolName: string,
  configuredHandler?: string,
): DynamicToolFn {
  const candidateNames = [
    configuredHandler,
    toolName,
    normalizeExportedName(toolName),
    'runTool',
    'default',
  ].filter((name): name is string => Boolean(name));

  for (const name of candidateNames) {
    const candidate = name === 'default' ? module.default : module[name];
    if (typeof candidate === 'function') {
      return candidate as DynamicToolFn;
    }
  }

  throw new Error(
    `No runnable export found for tool \`${toolName}\`. Expected one of: ${candidateNames.join(', ')}`,
  );
}
