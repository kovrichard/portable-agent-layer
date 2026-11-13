import { readFileSync } from "node:fs";
import { canonicalPalCmd, isOutdatedPalHook } from "../pal-hook-command";

type CodexHookCommand = { type: string; command: string; timeout?: number };
type CodexHookGroup = { matcher?: string; hooks: CodexHookCommand[] };
type CodexHooks = {
  hooks?: Record<string, CodexHookGroup[]>;
  description?: string;
  version?: unknown;
};

/**
 * Codex parses hooks.json strictly and accepts only `description` and `hooks`.
 * A stale `version` makes it reject the whole file — every PAL hook silently
 * stops — and merging preserves what it finds, so it must be dropped by name.
 */
function withoutRejectedFields(config: CodexHooks): CodexHooks {
  const { version: _version, ...accepted } = config;

  return accepted;
}

export function loadCodexHooksTemplate(
  templatePath: string,
  pkgRoot: string
): CodexHooks {
  const raw = readFileSync(templatePath, "utf-8");
  const resolved = raw.replaceAll("{{PKG_ROOT}}", pkgRoot);

  try {
    return JSON.parse(resolved) as CodexHooks;
  } catch (e) {
    throw new Error(`Failed to parse Codex hooks template at ${templatePath}: ${e}`);
  }
}

/** Collect canonical command paths from a Codex hooks template (PAL-managed commands). */
function collectPalCanonical(template: CodexHooks): Set<string> {
  return new Set(
    Object.values(template.hooks ?? {}).flatMap((groups) =>
      groups.flatMap((g) => g.hooks.map((h) => canonicalPalCmd(h.command)))
    )
  );
}

/** Strip entries (nested or flat) whose canonical command matches a PAL-managed command. */
function stripPalHooks(
  hooks: Record<string, CodexHookGroup[]>,
  palCanonical: Set<string>
): void {
  for (const event of Object.keys(hooks)) {
    hooks[event] = (hooks[event] ?? [])
      .map((g) => {
        const flat = g as unknown as CodexHookCommand;
        if (!g.hooks && flat.command && isOutdatedPalHook(flat.command, palCanonical)) {
          return null;
        }

        const filtered = (g.hooks ?? []).filter(
          (h) => !isOutdatedPalHook(h.command, palCanonical)
        );

        return filtered.length > 0 ? { ...g, hooks: filtered } : null;
      })
      .filter((g): g is CodexHookGroup => g !== null);

    if (hooks[event].length === 0) delete hooks[event];
  }
}

/** Merge PAL hooks into an existing Codex hooks.json. Deduplicates by canonical command path. */
export function mergeCodexHooks(existing: CodexHooks, template: CodexHooks): CodexHooks {
  const result: CodexHooks = withoutRejectedFields(existing);

  if (!template.hooks) return result;
  result.hooks ??= {};

  stripPalHooks(result.hooks, collectPalCanonical(template));

  for (const [event, groups] of Object.entries(template.hooks)) {
    const current = result.hooks[event] ?? [];

    for (const group of groups) current.push(group);
    result.hooks[event] = current;
  }

  return result;
}

/** Remove PAL hooks from an existing Codex hooks.json. Preserves user hooks. */
export function unmergeCodexHooks(
  existing: CodexHooks,
  template: CodexHooks
): CodexHooks {
  const result: CodexHooks = withoutRejectedFields(existing);
  if (!template.hooks || !result.hooks) return result;

  stripPalHooks(result.hooks, collectPalCanonical(template));

  if (Object.keys(result.hooks).length === 0) delete result.hooks;

  return result;
}
