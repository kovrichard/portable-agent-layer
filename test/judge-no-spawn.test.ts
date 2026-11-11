import { expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const HOOKS = resolve(import.meta.dir, "../src/hooks");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = resolve(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return path.endsWith(".ts") ? [path] : [];
  });
}

test("hooks make judgments through the library, which exists", () => {
  expect(existsSync(resolve(HOOKS, "lib/judge.ts"))).toBe(true);
  expect(readFileSync(resolve(HOOKS, "handlers/rating.ts"), "utf-8")).toContain(
    "lib/judge"
  );
});

test("no file under src/hooks runs `pal cli judge` or spawns the CLI entry point", () => {
  for (const file of sources(HOOKS)) {
    const text = readFileSync(file, "utf-8");
    expect(text).not.toMatch(/pal cli judge/);
    expect(text).not.toMatch(/["'`]cli["'],\s*["'`]judge["'`]/);
    expect(text).not.toMatch(/cli\/index(\.ts)?["'`]/);
  }
});
