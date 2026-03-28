import { exec as execCallback } from 'child_process';
import { promisify } from 'util';
import path from 'path';

const exec = promisify(execCallback);

type Context = {
  toolName: string;
  input: Record<string, unknown>;
  workspaceRoot: string;
};

function resolveSafePath(workspaceRoot: string, targetPath: string): string {
  const absolute = path.resolve(workspaceRoot, targetPath);
  const normalizedWorkspace = path.resolve(workspaceRoot);
  if (!absolute.startsWith(normalizedWorkspace)) {
    throw new Error(`Path escapes workspace: ${targetPath}`);
  }
  return absolute;
}

export async function runTool(context: Context) {
  if (context.toolName !== 'shell_exec') {
    throw new Error(`Unsupported tool: ${context.toolName}`);
  }

  const command = String(context.input.command ?? '').trim();
  if (!command) {
    throw new Error('command is required');
  }

  const cwd = context.input.cwd
    ? resolveSafePath(context.workspaceRoot, String(context.input.cwd))
    : context.workspaceRoot;

  const rawTimeout = Number(context.input.timeout_ms ?? context.input.timeoutMs ?? 60_000);
  const timeout = Number.isFinite(rawTimeout) ? Math.max(1_000, Math.min(300_000, Math.floor(rawTimeout))) : 60_000;

  try {
    const { stdout, stderr } = await exec(command, {
      cwd,
      windowsHide: true,
      timeout,
    });

    return {
      ok: true,
      stdout,
      stderr,
      output: [stdout, stderr].filter(Boolean).join('\n') || '(no output)',
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
      code: typed.code,
      stdout: typed.stdout ?? '',
      stderr: typed.stderr ?? '',
      error: typed.message ?? 'Command failed',
      output: [typed.stdout ?? '', typed.stderr ?? '', typed.message ?? 'Command failed']
        .filter((item) => item && item.trim().length > 0)
        .join('\n'),
    };
  }
}
