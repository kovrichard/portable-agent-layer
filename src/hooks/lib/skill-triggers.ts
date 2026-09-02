/**
 * SKILL.md trigger declarations — the words and phrases a prompt carries when it
 * wants a given skill.
 *
 * `metadata` is the only frontmatter key Anthropic's skill spec reserves for
 * third-party tooling, so triggers live under it; a top-level `triggers:` key
 * fails skill packaging with an unexpected-key error. Shared by the skill-index
 * generator (which publishes them) and the skill doctor (which warns when a
 * skill declares none).
 */

/** Indented lines belonging to the frontmatter `metadata:` map, or [] when absent. */
function metadataBlock(frontmatter: string): string[] {
  const lines = frontmatter.split("\n");
  const start = lines.findIndex((line) => /^metadata:\s*$/.test(line));
  if (start === -1) return [];

  const block: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === "") continue;
    if (!/^\s/.test(line)) break;
    block.push(line);
  }
  return block;
}

/** Normalize one authored trigger: unquote, collapse whitespace, lowercase. */
function normalizeTrigger(raw: string): string {
  return raw
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Split a YAML flow sequence — `["a", "b"]` or `[a, b]` — into its items. */
function splitFlowSequence(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.map((item) => String(item));
  } catch {
    /* not strict JSON — fall through to the permissive split */
  }
  return value.slice(1, -1).split(",");
}

/** Items of a YAML block sequence: the `- item` lines directly under a key. */
function blockSequenceItems(lines: string[]): string[] {
  const items: string[] = [];
  for (const line of lines) {
    const item = /^\s*-\s+(.*)$/.exec(line);
    if (!item) break;
    items.push(item[1]);
  }
  return items;
}

/**
 * Author-declared `metadata.triggers` — the words and phrases a prompt is matched
 * against. Accepts either YAML shape:
 *
 *   metadata:            |   metadata:
 *     triggers:          |     triggers: ["make a deck", "slides"]
 *       - make a deck    |
 *       - slides         |
 *
 * `metadata` is the only frontmatter key Anthropic's skill spec reserves for
 * third-party tooling; a top-level `triggers:` key fails skill packaging.
 */
export function declaredTriggers(frontmatter: string): string[] {
  const block = metadataBlock(frontmatter);
  const at = block.findIndex((line) => /^\s*triggers:/.test(line));
  if (at === -1) return [];

  const inline = /^\s*triggers:\s*(\S.*)$/.exec(block[at])?.[1];
  const raw = inline
    ? splitFlowSequence(inline)
    : blockSequenceItems(block.slice(at + 1));

  return [...new Set(raw.map(normalizeTrigger).filter(Boolean))];
}
