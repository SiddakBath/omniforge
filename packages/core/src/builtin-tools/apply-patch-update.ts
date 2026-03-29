type UpdateFileChunk = {
  changeContext?: string;
  oldLines: string[];
  newLines: string[];
  isEndOfFile: boolean;
};

type FileTextParts = {
  lines: string[];
  eol: string;
  trailingNewline: boolean;
};

function parseFileText(content: string): FileTextParts {
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  const trailingNewline = content.endsWith('\n');

  if (!content) {
    return {
      lines: [],
      eol,
      trailingNewline,
    };
  }

  const rawLines = content.split(/\r?\n/);
  if (trailingNewline && rawLines.length > 0 && rawLines[rawLines.length - 1] === '') {
    rawLines.pop();
  }

  return {
    lines: rawLines,
    eol,
    trailingNewline,
  };
}

function formatFileText(parts: FileTextParts): string {
  if (parts.lines.length === 0) {
    return parts.trailingNewline ? parts.eol : '';
  }
  return `${parts.lines.join(parts.eol)}${parts.trailingNewline ? parts.eol : ''}`;
}

function matchesAt(lines: string[], candidate: string[], at: number): boolean {
  if (at < 0 || at + candidate.length > lines.length) {
    return false;
  }
  for (let i = 0; i < candidate.length; i += 1) {
    if (lines[at + i] !== candidate[i]) {
      return false;
    }
  }
  return true;
}

function findWithContext(
  lines: string[],
  context: string,
  oldLines: string[],
  startFrom: number,
): number | undefined {
  for (let i = Math.max(0, startFrom); i < lines.length; i += 1) {
    if (lines[i] !== context) {
      continue;
    }
    const candidateIndex = i + 1;
    if (matchesAt(lines, oldLines, candidateIndex)) {
      return candidateIndex;
    }
  }
  return undefined;
}

function findWithoutContext(lines: string[], oldLines: string[], startFrom: number): number | undefined {
  const start = Math.max(0, startFrom);

  if (oldLines.length === 0) {
    return Math.min(start, lines.length);
  }

  const maxStart = lines.length - oldLines.length;
  for (let i = start; i <= maxStart; i += 1) {
    if (matchesAt(lines, oldLines, i)) {
      return i;
    }
  }

  return undefined;
}

function findChunkIndex(lines: string[], chunk: UpdateFileChunk, cursor: number): number {
  if (chunk.isEndOfFile) {
    if (chunk.oldLines.length === 0) {
      return lines.length;
    }

    const candidate = lines.length - chunk.oldLines.length;
    if (matchesAt(lines, chunk.oldLines, candidate)) {
      return candidate;
    }

    throw new Error('Failed to apply update chunk at EOF: expected lines were not found at end of file.');
  }

  if (chunk.changeContext && chunk.changeContext.length > 0) {
    const contextual = findWithContext(lines, chunk.changeContext, chunk.oldLines, cursor);
    if (contextual !== undefined) {
      return contextual;
    }
  }

  const direct = findWithoutContext(lines, chunk.oldLines, cursor);
  if (direct !== undefined) {
    return direct;
  }

  throw new Error(
    chunk.changeContext
      ? `Failed to apply update chunk near context '${chunk.changeContext}'.`
      : 'Failed to apply update chunk: expected lines were not found.',
  );
}

export function applyUpdateHunk(existingContent: string, chunks: UpdateFileChunk[]): string {
  const parts = parseFileText(existingContent);
  const lines = [...parts.lines];
  let cursor = 0;

  for (const chunk of chunks) {
    const index = findChunkIndex(lines, chunk, cursor);
    lines.splice(index, chunk.oldLines.length, ...chunk.newLines);
    cursor = Math.max(0, index + chunk.newLines.length);
  }

  return formatFileText({
    lines,
    eol: parts.eol,
    trailingNewline: parts.trailingNewline,
  });
}
