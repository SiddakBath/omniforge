import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import path from 'path';
import type { BuiltinToolSpec } from './types.js';
import { resolveSafePath } from './utils.js';
import { applyUpdateHunk } from './apply-patch-update.js';

const BEGIN_PATCH_MARKER = '*** Begin Patch';
const END_PATCH_MARKER = '*** End Patch';
const ADD_FILE_MARKER = '*** Add File: ';
const DELETE_FILE_MARKER = '*** Delete File: ';
const UPDATE_FILE_MARKER = '*** Update File: ';
const MOVE_TO_MARKER = '*** Move to: ';
const EOF_MARKER = '*** End of File';
const CHANGE_CONTEXT_MARKER = '@@ ';
const EMPTY_CHANGE_CONTEXT_MARKER = '@@';

type AddFileHunk = {
  kind: 'add';
  path: string;
  contents: string;
};

type DeleteFileHunk = {
  kind: 'delete';
  path: string;
};

type UpdateFileChunk = {
  changeContext?: string;
  oldLines: string[];
  newLines: string[];
  isEndOfFile: boolean;
};

type UpdateFileHunk = {
  kind: 'update';
  path: string;
  movePath?: string;
  chunks: UpdateFileChunk[];
};

type Hunk = AddFileHunk | DeleteFileHunk | UpdateFileHunk;

type ApplyPatchSummary = {
  added: string[];
  modified: string[];
  deleted: string[];
};

type ParsePatchResult = {
  hunks: Hunk[];
};

type ResolvedPatchPath = {
  resolved: string;
  display: string;
};

export const applyPatchTool: BuiltinToolSpec = {
  definition: {
    category: 'builtin',
    name: 'apply_patch',
    description:
      'Apply file changes using the *** Begin Patch/*** End Patch format with Add/Delete/Update hunks.',
    parameters: {
      type: 'object',
      properties: {
        input: {
          type: 'string',
          description: 'Patch content in apply_patch format.',
        },
      },
      required: ['input'],
    },
  },
  execute: async (call, context) => {
    const input = typeof call.input.input === 'string' ? call.input.input : '';
    if (!input.trim()) {
      return { ok: false, output: 'input is required and must contain patch text.' };
    }

    try {
      const result = await applyPatch(input, context.workspaceRoot);
      return {
        ok: true,
        output: JSON.stringify(
          {
            summary: result.summary,
            text: result.text,
          },
          null,
          2,
        ),
      };
    } catch (error) {
      return {
        ok: false,
        output: error instanceof Error ? error.message : 'Failed to apply patch.',
      };
    }
  },
};

async function applyPatch(input: string, workspaceRoot: string): Promise<{
  summary: ApplyPatchSummary;
  text: string;
}> {
  const parsed = parsePatchText(input);
  if (parsed.hunks.length === 0) {
    throw new Error('No files were modified.');
  }

  const summary: ApplyPatchSummary = {
    added: [],
    modified: [],
    deleted: [],
  };

  const seen = {
    added: new Set<string>(),
    modified: new Set<string>(),
    deleted: new Set<string>(),
  };

  for (const hunk of parsed.hunks) {
    if (hunk.kind === 'add') {
      const target = resolvePatchPath(workspaceRoot, hunk.path);
      await ensureDir(target.resolved);
      await writeFile(target.resolved, hunk.contents, 'utf8');
      recordSummary(summary, seen, 'added', target.display);
      continue;
    }

    if (hunk.kind === 'delete') {
      const target = resolvePatchPath(workspaceRoot, hunk.path);
      await rm(target.resolved);
      recordSummary(summary, seen, 'deleted', target.display);
      continue;
    }

    const target = resolvePatchPath(workspaceRoot, hunk.path);
    const existing = await readFile(target.resolved, 'utf8');
    const applied = applyUpdateHunk(existing, hunk.chunks);

    if (hunk.movePath) {
      const moved = resolvePatchPath(workspaceRoot, hunk.movePath);
      await ensureDir(moved.resolved);
      await writeFile(moved.resolved, applied, 'utf8');
      await rm(target.resolved);
      recordSummary(summary, seen, 'modified', moved.display);
      continue;
    }

    await writeFile(target.resolved, applied, 'utf8');
    recordSummary(summary, seen, 'modified', target.display);
  }

  return {
    summary,
    text: formatSummary(summary),
  };
}

function recordSummary(
  summary: ApplyPatchSummary,
  seen: {
    added: Set<string>;
    modified: Set<string>;
    deleted: Set<string>;
  },
  bucket: keyof ApplyPatchSummary,
  value: string,
): void {
  if (seen[bucket].has(value)) {
    return;
  }
  seen[bucket].add(value);
  summary[bucket].push(value);
}

function formatSummary(summary: ApplyPatchSummary): string {
  const lines = ['Success. Updated the following files:'];
  for (const file of summary.added) {
    lines.push(`A ${file}`);
  }
  for (const file of summary.modified) {
    lines.push(`M ${file}`);
  }
  for (const file of summary.deleted) {
    lines.push(`D ${file}`);
  }
  return lines.join('\n');
}

async function ensureDir(filePath: string): Promise<void> {
  const parent = path.dirname(filePath);
  if (!parent || parent === '.') {
    return;
  }
  await mkdir(parent, { recursive: true });
}

function resolvePatchPath(workspaceRoot: string, filePath: string): ResolvedPatchPath {
  const normalized = filePath.trim();
  if (!normalized) {
    throw new Error('Patch file path cannot be empty.');
  }
  const resolved = resolveSafePath(workspaceRoot, normalized);
  return {
    resolved,
    display: toDisplayPath(resolved, workspaceRoot),
  };
}

function toDisplayPath(resolved: string, workspaceRoot: string): string {
  const relative = path.relative(workspaceRoot, resolved);
  if (!relative || relative.length === 0) {
    return path.basename(resolved);
  }
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return resolved;
  }
  return relative;
}

function parsePatchText(input: string): ParsePatchResult {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error('Invalid patch: input is empty.');
  }

  const lines = trimmed.split(/\r?\n/);
  const validated = checkPatchBoundariesLenient(lines);
  const hunks: Hunk[] = [];

  const lastLineIndex = validated.length - 1;
  let remaining = validated.slice(1, lastLineIndex);
  let lineNumber = 2;

  while (remaining.length > 0) {
    const { hunk, consumed } = parseOneHunk(remaining, lineNumber);
    hunks.push(hunk);
    lineNumber += consumed;
    remaining = remaining.slice(consumed);
  }

  return { hunks };
}

function checkPatchBoundariesLenient(lines: string[]): string[] {
  const strictError = checkPatchBoundariesStrict(lines);
  if (!strictError) {
    return lines;
  }

  if (lines.length < 4) {
    throw new Error(strictError);
  }

  const first = lines[0];
  const last = lines[lines.length - 1] ?? '';
  if (
    (first === '<<EOF' || first === "<<'EOF'" || first === '<<"EOF"') &&
    last.endsWith('EOF')
  ) {
    const inner = lines.slice(1, lines.length - 1);
    const innerError = checkPatchBoundariesStrict(inner);
    if (!innerError) {
      return inner;
    }
    throw new Error(innerError);
  }

  throw new Error(strictError);
}

function checkPatchBoundariesStrict(lines: string[]): string | null {
  const firstLine = lines[0]?.trim();
  const lastLine = lines[lines.length - 1]?.trim();

  if (firstLine === BEGIN_PATCH_MARKER && lastLine === END_PATCH_MARKER) {
    return null;
  }
  if (firstLine !== BEGIN_PATCH_MARKER) {
    return "The first line of the patch must be '*** Begin Patch'";
  }
  return "The last line of the patch must be '*** End Patch'";
}

function parseOneHunk(lines: string[], lineNumber: number): { hunk: Hunk; consumed: number } {
  if (lines.length === 0) {
    throw new Error(`Invalid patch hunk at line ${lineNumber}: empty hunk`);
  }

  const firstLine = (lines[0] ?? '').trim();

  if (firstLine.startsWith(ADD_FILE_MARKER)) {
    const targetPath = firstLine.slice(ADD_FILE_MARKER.length);
    let contents = '';
    let consumed = 1;

    for (const addLine of lines.slice(1)) {
      if (addLine.startsWith('+')) {
        contents += `${addLine.slice(1)}\n`;
        consumed += 1;
      } else {
        break;
      }
    }

    return {
      hunk: {
        kind: 'add',
        path: targetPath,
        contents,
      },
      consumed,
    };
  }

  if (firstLine.startsWith(DELETE_FILE_MARKER)) {
    const targetPath = firstLine.slice(DELETE_FILE_MARKER.length);
    return {
      hunk: {
        kind: 'delete',
        path: targetPath,
      },
      consumed: 1,
    };
  }

  if (firstLine.startsWith(UPDATE_FILE_MARKER)) {
    const targetPath = firstLine.slice(UPDATE_FILE_MARKER.length);
    let remaining = lines.slice(1);
    let consumed = 1;
    let movePath: string | undefined;

    const moveCandidate = remaining[0]?.trim();
    if (moveCandidate?.startsWith(MOVE_TO_MARKER)) {
      movePath = moveCandidate.slice(MOVE_TO_MARKER.length);
      remaining = remaining.slice(1);
      consumed += 1;
    }

    const chunks: UpdateFileChunk[] = [];
    while (remaining.length > 0) {
      if ((remaining[0] ?? '').trim() === '') {
        remaining = remaining.slice(1);
        consumed += 1;
        continue;
      }

      if ((remaining[0] ?? '').startsWith('***')) {
        break;
      }

      const parsed = parseUpdateFileChunk(remaining, lineNumber + consumed, chunks.length === 0);
      chunks.push(parsed.chunk);
      remaining = remaining.slice(parsed.consumed);
      consumed += parsed.consumed;
    }

    if (chunks.length === 0) {
      throw new Error(
        `Invalid patch hunk at line ${lineNumber}: Update file hunk for path '${targetPath}' is empty`,
      );
    }

    return {
      hunk: {
        kind: 'update',
        path: targetPath,
        ...(movePath ? { movePath } : {}),
        chunks,
      },
      consumed,
    };
  }

  throw new Error(
    `Invalid patch hunk at line ${lineNumber}: '${lines[0] ?? ''}' is not a valid hunk header. Valid hunk headers: '*** Add File: {path}', '*** Delete File: {path}', '*** Update File: {path}'`,
  );
}

function parseUpdateFileChunk(
  lines: string[],
  lineNumber: number,
  allowMissingContext: boolean,
): { chunk: UpdateFileChunk; consumed: number } {
  if (lines.length === 0) {
    throw new Error(
      `Invalid patch hunk at line ${lineNumber}: Update hunk does not contain any lines`,
    );
  }

  let changeContext: string | undefined;
  let startIndex = 0;

  const first = lines[0] ?? '';
  if (first === EMPTY_CHANGE_CONTEXT_MARKER) {
    startIndex = 1;
  } else if (first.startsWith(CHANGE_CONTEXT_MARKER)) {
    changeContext = first.slice(CHANGE_CONTEXT_MARKER.length);
    startIndex = 1;
  } else if (!allowMissingContext) {
    throw new Error(
      `Invalid patch hunk at line ${lineNumber}: Expected update hunk to start with a @@ context marker, got: '${first}'`,
    );
  }

  if (startIndex >= lines.length) {
    throw new Error(
      `Invalid patch hunk at line ${lineNumber + 1}: Update hunk does not contain any lines`,
    );
  }

  const chunk: UpdateFileChunk = {
    oldLines: [],
    newLines: [],
    isEndOfFile: false,
  };

  if (changeContext !== undefined) {
    chunk.changeContext = changeContext;
  }

  let parsedLines = 0;
  for (const line of lines.slice(startIndex)) {
    if (line === EOF_MARKER) {
      if (parsedLines === 0) {
        throw new Error(
          `Invalid patch hunk at line ${lineNumber + 1}: Update hunk does not contain any lines`,
        );
      }
      chunk.isEndOfFile = true;
      parsedLines += 1;
      break;
    }

    const marker = line[0];
    if (!marker) {
      chunk.oldLines.push('');
      chunk.newLines.push('');
      parsedLines += 1;
      continue;
    }

    if (marker === ' ') {
      const content = line.slice(1);
      chunk.oldLines.push(content);
      chunk.newLines.push(content);
      parsedLines += 1;
      continue;
    }

    if (marker === '+') {
      chunk.newLines.push(line.slice(1));
      parsedLines += 1;
      continue;
    }

    if (marker === '-') {
      chunk.oldLines.push(line.slice(1));
      parsedLines += 1;
      continue;
    }

    if (parsedLines === 0) {
      throw new Error(
        `Invalid patch hunk at line ${lineNumber + 1}: Unexpected line found in update hunk: '${line}'. Every line should start with ' ' (context line), '+' (added line), or '-' (removed line)`,
      );
    }
    break;
  }

  return {
    chunk,
    consumed: parsedLines + startIndex,
  };
}
