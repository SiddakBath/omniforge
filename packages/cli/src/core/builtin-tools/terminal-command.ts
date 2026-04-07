import { exec as execCallback } from 'child_process';
import { promisify } from 'util';
import type { BuiltinToolSpec } from './types.js';
import { clampTimeout, resolveSafePath } from './utils.js';

const exec = promisify(execCallback);

export const terminalCommandTool: BuiltinToolSpec = {
  definition: {
    category: 'builtin',
    name: 'terminal_command',
    description: 'Execute a shell command in the local workspace with timeout controls.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string' },
        cwd: { type: 'string' },
        timeout_ms: { type: 'number', default: 60000 },
      },
      required: ['command'],
    },
  },
  aliases: ['shell_exec'],
  execute: async (call, context) => {
    const command = String(call.input.command ?? '').trim();
    if (!command) {
      return { ok: false, output: 'command is required' };
    }

    let cwd = context.workspaceRoot;
    if (typeof call.input.cwd === 'string' && call.input.cwd.trim().length > 0) {
      try {
        cwd = resolveSafePath(context.workspaceRoot, call.input.cwd);
      } catch (error) {
        return { ok: false, output: error instanceof Error ? error.message : 'Invalid cwd.' };
      }
    }

    const timeout = clampTimeout(call.input.timeout_ms ?? call.input.timeoutMs, 60_000, 300_000);

    try {
      const { stdout, stderr } = await exec(command, {
        cwd,
        timeout,
        windowsHide: true,
        maxBuffer: 8 * 1024 * 1024,
      });

      return {
        ok: true,
        output: JSON.stringify({
          ok: true,
          stdout,
          stderr,
          output: [stdout, stderr].filter(Boolean).join('\n') || '(no output)',
        }),
      };
    } catch (error) {
      const typed = error as {
        message?: string;
        stdout?: string;
        stderr?: string;
        code?: number | string;
      };

      return {
        ok: false,
        output: JSON.stringify({
          ok: false,
          code: typed.code,
          stdout: typed.stdout ?? '',
          stderr: typed.stderr ?? '',
          error: typed.message ?? 'Command failed',
        }),
      };
    }
  },
};
