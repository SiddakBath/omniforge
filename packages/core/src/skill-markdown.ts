import YAML from 'yaml';
import type { RequiredParam, Skill } from './types.js';

const FRONTMATTER_PATTERN = /^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter((entry) => entry.length > 0);
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function isValidParamKey(key: string): boolean {
  // Parameter keys must be UPPERCASE_SNAKE_CASE and valid as environment variable names
  return /^[A-Z][A-Z0-9_]*$/.test(key) && key.length <= 255;
}

function extractRequirements(skillName: string, metadata: Record<string, unknown> | undefined): {
  requiredParams: RequiredParam[];
  requiredBins: string[];
} {
  // Look for requirements at metadata.requires or metadata root level
  const requires = metadata && isRecord(metadata.requires) ? metadata.requires : metadata;
  if (!requires || !isRecord(requires)) {
    return { requiredParams: [], requiredBins: [] };
  }

  const requiredBins = asStringArray(requires.bins);
  const requiredParamKeys = asStringArray(requires.params);
  const optionalParamKeys = asStringArray(requires.optional);
  const allParamKeys = [...requiredParamKeys, ...optionalParamKeys];

  // Validate parameter keys follow naming convention
  const invalidKeys = allParamKeys.filter((key) => !isValidParamKey(key));
  if (invalidKeys.length > 0) {
    throw new Error(
      `Skill "${skillName}" has invalid parameter keys: ${invalidKeys.join(', ')}. ` +
      `Parameter keys must be UPPERCASE_SNAKE_CASE (e.g., OPENAI_API_KEY, GOOGLE_SHEETS_ID).`
    );
  }

  const requiredParams = requiredParamKeys.map((paramKey) => ({
    key: paramKey,
    label: paramKey,
    description: `Credential required by skill "${skillName}".`,
    secret: true,
    required: true,
  }));

  const optionalParams = optionalParamKeys.map((paramKey) => ({
    key: paramKey,
    label: paramKey,
    description: `Optional credential for skill "${skillName}".`,
    secret: true,
    required: false,
  }));

  return { requiredParams: [...requiredParams, ...optionalParams], requiredBins };
}

function sanitizeFrontmatter(frontmatter: string): string {
  return frontmatter
    .split(/\r?\n/)
    .map((line) => {
      const match = line.match(/^(\s*)(name|description|homepage)\s*:\s*(.*)$/);
      if (!match) {
        return line;
      }

      const [, indent, key, rawValue = ''] = match;
      const trimmed = rawValue.trim();

      // If value is empty, block scalar, already quoted, or appears to be structured metadata, leave it.
      if (
        trimmed === '' ||
        /^(["'])(.*)\1$/.test(trimmed) ||
        /^[>|]/.test(trimmed) ||
        /^[\[{]/.test(trimmed)
      ) {
        return line;
      }

      // If the value contains unquoted colon, quote it.
      if (trimmed.includes(':')) {
        const escaped = JSON.stringify(trimmed);
        return `${indent}${key}: ${escaped}`;
      }

      return line;
    })
    .join('\n');
}

export function parseSkillMarkdown(markdown: string, options?: { idHint?: string; createdAt?: string }): Skill {
  const match = markdown.match(FRONTMATTER_PATTERN);
  if (!match) {
    throw new Error('Skill markdown is missing YAML frontmatter.');
  }

  const rawFrontmatter = match[1] ?? '';
  let parsed: unknown;

  try {
    parsed = YAML.parse(rawFrontmatter);
  } catch (origError) {
    const sanitized = sanitizeFrontmatter(rawFrontmatter);
    try {
      parsed = YAML.parse(sanitized);
    } catch (sanitizedError) {
      throw new Error(
        `Skill frontmatter failed YAML parse. original error: ${origError}. ` +
        `sanitized attempt error: ${sanitizedError}. Raw frontmatter:\n${rawFrontmatter}`,
      );
    }
  }

  if (!isRecord(parsed)) {
    throw new Error('Skill frontmatter must be a YAML object.');
  }

  const name = asString(parsed.name) ?? options?.idHint ?? 'Untitled Skill';
  const id = asString(parsed.id) ?? slugify(options?.idHint ?? name);
  const description = asString(parsed.description) ?? `Playbook for ${name}`;
  const homepage = asString(parsed.homepage);
  const metadata = isRecord(parsed.metadata) ? parsed.metadata : undefined;
  const body = markdown.slice(match[0].length).trim();
  const { requiredParams, requiredBins } = extractRequirements(name, metadata);

  return {
    id,
    name,
    description,
    ...(homepage ? { homepage } : {}),
    ...(metadata ? { metadata } : {}),
    content: body,
    requiredParams,
    requiredBins,
    createdAt: options?.createdAt ?? new Date().toISOString(),
  };
}

export function renderSkillMarkdown(skill: Skill): string {
  const frontmatter: Record<string, unknown> = {
    name: skill.name,
    description: skill.description,
  };

  if (skill.homepage) {
    frontmatter.homepage = skill.homepage;
  }

  if (skill.metadata && Object.keys(skill.metadata).length > 0) {
    frontmatter.metadata = skill.metadata;
  }

  const yamlText = YAML.stringify(frontmatter).trimEnd();
  const body = skill.content.trim();

  return `---\n${yamlText}\n---\n\n${body}\n`;
}
