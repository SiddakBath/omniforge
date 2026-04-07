import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import type { BuiltinToolSpec } from './types.js';
import { resolveSafePath } from './utils.js';

export const writeFileTool: BuiltinToolSpec = {
  definition: {
    category: 'builtin',
    name: 'write_file',
    description: 'Write UTF-8 text to a file inside the workspace.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Workspace-relative file path.' },
        content: { type: 'string', description: 'Content to write.' },
        append: { type: 'boolean', default: false },
      },
      required: ['path', 'content'],
    },
  },
  aliases: ['file_write'],
  execute: async (call, context) => {
    const requestedPath = String(call.input.path ?? '').trim();
    if (!requestedPath) {
      return { ok: false, output: 'path is required' };
    }

    const content = String(call.input.content ?? '');
    const append = Boolean(call.input.append ?? false);

    try {
      const filePath = resolveSafePath(context.workspaceRoot, requestedPath);
      await mkdir(path.dirname(filePath), { recursive: true });

      if (append) {
        let previous = '';
        try {
          previous = await readFile(filePath, 'utf8');
        } catch {
          previous = '';
        }
        await writeFile(filePath, `${previous}${content}`, 'utf8');
      } else {
        await writeFile(filePath, content, 'utf8');
      }

      return {
        ok: true,
        output: JSON.stringify({ path: requestedPath, bytes: content.length, append }, null, 2),
      };
    } catch (error) {
      return { ok: false, output: error instanceof Error ? error.message : 'Failed to write file.' };
    }
  },
};
