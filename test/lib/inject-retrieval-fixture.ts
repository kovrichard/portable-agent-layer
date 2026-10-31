import { beforeAll, beforeEach } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { removeOnceReleased } from "./remove-once-released";
import { testHome } from "./test-home";

let home: string;

/** This suite's PAL home, with the memory a retrieval reads emptied before every test. */
export function injectRetrievalHome(file: string): string {
  home = testHome(file);
  beforeAll(() => {
    process.env.PAL_HOME = home;
    removeOnceReleased(home);
    mkdirSync(home, { recursive: true });
    mkdirSync(resolve(home, "memory"), { recursive: true });
  });
  beforeEach(async () => {
    for (const dir of [
      resolve(home, "memory", "learning"),
      resolve(home, "memory", "wisdom"),
      resolve(home, "memory", "state"),
      resolve(home, "memory", "adaptation"),
    ]) {
      removeOnceReleased(dir);
    }
    removeOnceReleased(resolve(home, "memory", "pal-settings.json"));
    // Bust the in-memory settings cache so a test that disabled the flag
    // doesn't poison the next test that wants the default-true behavior.
    const settings = await import("../../src/hooks/lib/settings");
    settings.reload();
  });
  return home;
}

export async function setSettings(data: Record<string, unknown>) {
  writeFileSync(resolve(home, "memory", "pal-settings.json"), JSON.stringify(data));
  const settings = await import("../../src/hooks/lib/settings");
  settings.reload();
}

export async function loadHandlers() {
  const t = Date.now();
  const mod = await import(`../../src/hooks/handlers/inject-retrieval.ts?t=${t}`);
  return {
    injectPromptContext: mod.injectPromptContext as (prompt: string) => Promise<void>,
    withinBudget: mod.withinBudget as <T>(work: () => T, ms: number) => T | null,
  };
}

export async function captureStdout(work: () => Promise<void>): Promise<string> {
  const original = process.stdout.write.bind(process.stdout);
  let captured = "";
  // biome-ignore lint/suspicious/noExplicitAny: test stub
  (process.stdout as any).write = (chunk: string | Uint8Array) => {
    captured += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString();
    return true;
  };
  try {
    await work();
  } finally {
    process.stdout.write = original;
  }
  return captured;
}
