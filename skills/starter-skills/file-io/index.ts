import path from 'path';
import { mkdir, readFile, writeFile } from 'fs/promises';

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
  if (context.toolName === 'file_read') {
    const targetPath = String(context.input.path ?? '').trim();
    if (!targetPath) {
      throw new Error('path is required');
    }
    const filePath = resolveSafePath(context.workspaceRoot, targetPath);
    const content = await readFile(filePath, 'utf8');
    return { path: targetPath, content };
  }

  if (context.toolName === 'file_write') {
    const targetPath = String(context.input.path ?? '').trim();
    if (!targetPath) {
      throw new Error('path is required');
    }
    const filePath = resolveSafePath(context.workspaceRoot, targetPath);
    const content = String(context.input.content ?? '');
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, content, 'utf8');
    return { path: targetPath, bytes: content.length, createdDirectories: true };
  }

  throw new Error(`Unsupported tool: ${context.toolName}`);
}
