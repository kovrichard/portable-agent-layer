import { existsSync } from "node:fs";
import { isAbsolute } from "node:path";

/**
 * Normalize a PAL hook command for cross-path deduplication.
 * Strips env-var prefix and normalizes the hook file path so reinstalling from
 * a different location (repo vs global install) correctly strips old entries.
 * "PAL_AGENT=x bun run /any/path/src/hooks/Foo.ts" → "bun run src/hooks/Foo.ts"
 */
export function canonicalPalCmd(cmd: string): string {
  const withoutEnv = cmd.replace(/^(?:\w+=\S+\s+)+/, "");
  const hookMatch = /bun\s+run\s+.+\/src\/hooks\/(\S+)/.exec(withoutEnv);
  if (hookMatch) return `bun run src/hooks/${hookMatch[1]}`;

  return withoutEnv;
}

function runsRemovedPalHook(cmd: string): boolean {
  const script = /bun\s+run\s+(\S+\/src\/hooks\/\S+\.ts)/.exec(cmd)?.[1];

  return script !== undefined && isAbsolute(script) && !existsSync(script);
}

export function isOutdatedPalHook(cmd: string, palCanonical: Set<string>): boolean {
  return palCanonical.has(canonicalPalCmd(cmd)) || runsRemovedPalHook(cmd);
}
