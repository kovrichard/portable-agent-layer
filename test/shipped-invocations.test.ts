import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { builtinToolVerbs } from "../src/cli/builtin-tools";

const ROOT = resolve(import.meta.dir, "..");
const SCANNED = ["assets", "src"];

/** Every `pal cli …` command PAL ships in instruction text, with where it came from. */
function shippedInvocations(pattern: RegExp): { file: string; command: string }[] {
  const found: { file: string; command: string }[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = resolve(dir, entry);
      if (statSync(path).isDirectory()) {
        if (entry !== "node_modules" && entry !== "dist") walk(path);
        continue;
      }
      if (!/\.(md|ts|json|rules|template)$/.test(entry)) continue;
      const text = readFileSync(path, "utf-8");
      for (const match of text.matchAll(pattern)) {
        found.push({ file: path.slice(ROOT.length + 1), command: match[0] });
      }
    }
  };
  for (const dir of SCANNED) walk(resolve(ROOT, dir));
  return found;
}

function toolIsShipped(skill: string, tool: string): boolean {
  const tools = resolve(ROOT, "assets/skills", skill, "tools");
  return existsSync(resolve(tools, tool)) || existsSync(resolve(tools, `${tool}.ts`));
}

describe("the `pal cli` commands PAL ships in its own instruction text", () => {
  test("every `pal cli skill run <skill> <tool>` names a tool that exists", () => {
    const uses = shippedInvocations(
      new RegExp(/pal cli skill run ([a-z0-9-]+) ([a-z0-9.-]+)/g)
    );
    expect(uses.length).toBeGreaterThan(0);

    const missing = uses.filter(({ command }) => {
      const [skill, tool] = command.split(" ").slice(4);
      return !skill || !tool || !toolIsShipped(skill, tool);
    });
    expect(missing).toEqual([]);
  });

  test("no shipped tool needs Node: every one runs under Bun", () => {
    const nodeRun = [
      ...shippedInvocations(new RegExp(/pal cli skill run [a-z0-9-]+ [a-z0-9-]+\.mjs/g)),
      ...shippedInvocations(new RegExp(/#!\/usr\/bin\/env node|pal-build:mjs/g)),
    ];

    expect(nodeRun).toEqual([]);
  });

  test("every `pal cli <verb>` naming a built-in tool is a registered verb", () => {
    const uses = shippedInvocations(new RegExp(/pal cli ([a-z0-9-]+)/g));
    expect(uses.length).toBeGreaterThan(0);

    // Subcommands of the CLI proper are out of scope here — this guards the
    // tool registry, which is the surface the doc rewrite moved onto.
    const toolish = uses.filter(({ command }) => command.split(" ")[2]?.includes("-"));
    const unregistered = toolish.filter(
      ({ command }) => !builtinToolVerbs.includes(command.split(" ")[2] ?? "")
    );
    expect(unregistered).toEqual([]);
  });

  test("no shipped instruction text invokes a tool through a tilde path", () => {
    const tildeUses = shippedInvocations(
      new RegExp(/^.*(?:bun|node) ~\/\.pal\/(?:tools|skills)\/\S+/gm)
    ).filter(({ file }) => !file.endsWith("builtin-tools.ts"));

    // The two allowlists keep the old forms on purpose: a user's own private
    // skills still invoke them (ISC-22), so removing them would start prompting.
    const inAllowlist = (file: string) =>
      file.endsWith("settings.claude.json") || file.endsWith("rules.codex.rules");
    expect(tildeUses.filter(({ file }) => !inAllowlist(file))).toEqual([]);
  });
});
