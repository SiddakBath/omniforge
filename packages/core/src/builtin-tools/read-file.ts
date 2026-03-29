import { readFile } from 'fs/promises';
import type { BuiltinToolContext, BuiltinToolExecutor, BuiltinToolSpec } from './types.js';
import { resolveSafePath } from './utils.js';

export const readFileTool: BuiltinToolSpec = {
  definition: {
    category: 'builtin',
    name: 'read_file',
    description: 'Read UTF-8 text from a file inside the workspace.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Workspace-relative file path.' },
      },
      required: ['path'],
    },
  },
  aliases: ['file_read'],
  execute: async (call: any, context: any) => {
    const requestedPath = String(call.input.path ?? '').trim();
    if (!requestedPath) {
      return { ok: false, output: 'path is required' };
    }

    try {
      const filePath = resolveSafePath(context.workspaceRoot, requestedPath);
      const content = await readFile(filePath, 'utf8');
      return {
        ok: true,
        output: JSON.stringify({ path: requestedPath, content }, null, 2),
      };
    } catch (error) {
      return { ok: false, output: error instanceof Error ? error.message : 'Failed to read file.' };
    }
  },
};
