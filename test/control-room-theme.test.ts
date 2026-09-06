import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { compileCss, themeDrift, themeOutput, themeSource } from "../scripts/build-ui";

const SCRATCH = resolve(import.meta.dir, "..", ".test-tmp", "control-room-theme");

function compileAgainst(markup: string): string {
  const dir = resolve(SCRATCH, Math.random().toString(36).slice(2));
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, "theme.css"), readFileSync(themeSource, "utf-8"));
  writeFileSync(resolve(dir, "index.html"), "");
  writeFileSync(resolve(dir, "fixture.tsx"), markup);
  const output = resolve(dir, "out.css");
  const failure = compileCss(resolve(dir, "theme.css"), output);
  if (failure) throw new Error(failure);
  const css = readFileSync(output, "utf-8");
  rmSync(dir, { recursive: true, force: true });
  return css;
}

describe("control room theme", () => {
  test("carries Industry's token layer whether or not a utility uses it", () => {
    const css = readFileSync(themeOutput, "utf-8");
    for (const step of [100, 300, 500, 700, 900]) {
      expect(css).toContain(`--color-accent-${step}:`);
    }
    expect(css).toContain('--font-heading: "Barlow Condensed"');
  });

  test("bases the spacing scale on Industry's 3.4px step", () => {
    const css = compileAgainst('export const F = () => <b className="p-4" />;');
    expect(css).toContain("--spacing: 0.2125rem");
    expect(css).toContain("padding: calc(var(--spacing) * 4)");
  });

  test("emits the blueprint frame only for markup that asks for it", () => {
    const withIt = compileAgainst('export const F = () => <b className="blueprint" />;');
    expect(withIt).toContain(".blueprint");
    expect(withIt).toContain("var(--registration-mark)");

    const without = compileAgainst('export const F = () => <b className="p-4" />;');
    expect(without).not.toContain(".blueprint");
  });

  test("keeps only Industry's palette — no stray Tailwind defaults", () => {
    const css = readFileSync(themeOutput, "utf-8");
    expect(css).not.toContain("--color-emerald");
    expect(css).not.toContain("--color-amber");
  });

  test("the committed stylesheet is in step with its source", () => {
    mkdirSync(SCRATCH, { recursive: true });
    expect(themeDrift(resolve(SCRATCH, "drift-check.css"))).toBeNull();
  });
});
