/**
 * Lightweight YAML frontmatter parser/serializer.
 *
 * No external dependencies — parses simple key: value YAML between --- delimiters.
 * Supports strings, numbers, booleans, and inline JSON arrays.
 */

interface Parsed<T = Record<string, string>> {
  meta: T;
  body: string;
}

const DELIMITER = /^---[ \t]*$/m;

interface FrontmatterSplit {
  leading: string;
  frontmatter: string;
  body: string;
}

/**
 * Split text at its first two `---` lines. The body keeps every character after
 * the closing delimiter, so later `---` rules and the lines around them survive.
 */
export function splitFrontmatter(content: string): FrontmatterSplit | null {
  const parts = content.split(DELIMITER);
  if (parts.length < 3) return null;
  return { leading: parts[0], frontmatter: parts[1], body: parts.slice(2).join("---") };
}

/**
 * Parse frontmatter from a markdown string.
 * Returns typed meta + body. If no frontmatter found, meta is empty and body is the full content.
 */
export function parse<T = Record<string, string>>(content: string): Parsed<T> {
  const split = splitFrontmatter(content);
  if (!split || split.leading.trim() !== "") {
    return { meta: {} as T, body: content };
  }

  const rawMeta = split.frontmatter;
  const body = split.body.trim();

  const meta: Record<string, unknown> = {};
  for (const line of rawMeta.split("\n")) {
    const match = new RegExp(/^(\w[\w-]*)\s*:\s*(.*)$/).exec(line);
    if (!match) continue;
    const [, key, rawValue] = match;
    meta[key] = parseValue(rawValue.trim());
  }

  return { meta: meta as T, body };
}

const NOT_JSON = Symbol("not-json");

function parseInlineArray(value: string): unknown {
  if (!(value.startsWith("[") && value.endsWith("]"))) return NOT_JSON;
  try {
    return JSON.parse(value);
  } catch {
    return NOT_JSON;
  }
}

function isQuoted(value: string): boolean {
  return (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  );
}

function coerceScalar(value: string): unknown {
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^\d+$/.test(value)) return Number.parseInt(value, 10);
  if (/^\d+\.\d+$/.test(value)) return Number.parseFloat(value);
  return value;
}

function parseValue(value: string): unknown {
  const array = parseInlineArray(value);
  if (array !== NOT_JSON) return array;
  if (isQuoted(value)) return value.slice(1, -1).replaceAll('\\"', '"');
  return coerceScalar(value);
}

/**
 * Serialize metadata and body into a frontmatter string.
 * Skips undefined/null values.
 */
export function stringify(meta: Record<string, unknown>, body: string): string {
  const lines: string[] = ["---"];

  for (const [key, value] of Object.entries(meta)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      lines.push(`${key}: ${JSON.stringify(value)}`);
    } else if (typeof value === "string") {
      lines.push(`${key}: "${value.replaceAll('"', '\\"')}"`);
    } else {
      lines.push(`${key}: ${String(value)}`);
    }
  }

  lines.push("---");
  return `${lines.join("\n")}\n\n${body.trim()}\n`;
}

/**
 * Check if content has frontmatter (starts with ---).
 */
export function hasFrontmatter(content: string): boolean {
  return content.trimStart().startsWith("---");
}
