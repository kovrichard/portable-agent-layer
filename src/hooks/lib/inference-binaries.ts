import { findBinaryOnPath } from "./which";

const binaryCache = new Map<string, string | null>();

function cachedBinary(name: string): string | null {
  const key = `${name}\0${process.env.PATH ?? ""}`;
  if (!binaryCache.has(key)) binaryCache.set(key, findBinaryOnPath(name));

  return binaryCache.get(key) ?? null;
}

export function getClaudeBinary(): string | null {
  return cachedBinary("claude");
}

export function getCodexBinary(): string | null {
  return cachedBinary("codex");
}

export function getOpencodeBinary(): string | null {
  return cachedBinary("opencode");
}

export function getCopilotBinary(): string | null {
  return cachedBinary("copilot");
}

export function getCursorBinary(): string | null {
  return cachedBinary("cursor-agent");
}

export function getAntigravityBinary(): string | null {
  return cachedBinary("agy");
}

export function hasClaudeBinary(): boolean {
  return getClaudeBinary() !== null;
}
export function hasCodexBinary(): boolean {
  return getCodexBinary() !== null;
}
export function hasOpencodeBinary(): boolean {
  return getOpencodeBinary() !== null;
}
export function hasCopilotBinary(): boolean {
  return getCopilotBinary() !== null;
}
export function hasCursorBinary(): boolean {
  return getCursorBinary() !== null;
}
export function hasAntigravityBinary(): boolean {
  return getAntigravityBinary() !== null;
}
