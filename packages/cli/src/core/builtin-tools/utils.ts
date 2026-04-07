import path from 'path';

export function resolveSafePath(workspaceRoot: string, targetPath: string): string {
  const absolute = path.resolve(workspaceRoot, targetPath);
  const normalizedWorkspace = path.resolve(workspaceRoot);
  if (!absolute.startsWith(normalizedWorkspace)) {
    throw new Error(`Path escapes workspace: ${targetPath}`);
  }
  return absolute;
}

export function clampTimeout(value: unknown, fallback: number, max: number): number {
  const raw = Number(value);
  if (!Number.isFinite(raw)) {
    return fallback;
  }
  return Math.max(1_000, Math.min(max, Math.floor(raw)));
}

export function normalizeHeaders(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const headers: Record<string, string> = {};
  for (const [key, val] of Object.entries(value)) {
    if (typeof val === 'string') {
      headers[key] = val;
    }
  }
  return headers;
}

export function withTimeoutSignal(timeoutMs: number): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('Request timed out')), timeoutMs);

  return {
    signal: controller.signal,
    clear: () => clearTimeout(timer),
  };
}
