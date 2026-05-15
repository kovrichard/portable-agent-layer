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

const DELIMITER = /^---\s*$/m;

/**
 * Parse frontmatter from a markdown string.
 * Returns typed meta + body. If no frontmatter found, meta is empty and body is the full content.
 */
export function parse<T = Record<string, string>>(content: string): Parsed<T> {
  const parts = content.split(DELIMITER);

  // Need at least 3 parts: before --- | frontmatter | after ---
  // parts[0] should be empty (content starts with ---)
  if (parts.length < 3 || parts[0].trim() !== "") {
    return { meta: {} as T, body: content };
  }

  const rawMeta = parts[1];
  const body = parts.slice(2).join("---").trim();

  const meta: Record<string, unknown> = {};
  for (const line of rawMeta.split("\n")) {
    const match = new RegExp(/^(\w[\w-]*)\s*:\s*(.*)$/).exec(line);
    if (!match) continue;
    const [, key, rawValue] = match;
    const value = rawValue.trim();

    // Inline JSON array
    if (value.startsWith("[") && value.endsWith("]")) {
      try {
        meta[key] = JSON.parse(value);
        continue;
      } catch {
        // Fall through to string handling
      }
    }

    // Strip quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      meta[key] = value.slice(1, -1).replaceAll('\\"', '"');
      continue;
    }

    // Type coercion
    if (value === "true") meta[key] = true;
    else if (value === "false") meta[key] = false;
    else if (/^\d+$/.test(value)) meta[key] = Number.parseInt(value, 10);
    else if (/^\d+\.\d+$/.test(value)) meta[key] = Number.parseFloat(value);
    else meta[key] = value;
  }

  return { meta: meta as T, body };
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
