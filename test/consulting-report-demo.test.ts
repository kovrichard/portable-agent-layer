import { beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  parseArgs,
  prepareDemo,
} from "../assets/skills/consulting-report/tools/generate-pdf";
import { freshTestDir } from "./lib/test-home";

const SKILL = resolve(import.meta.dir, "../assets/skills/consulting-report");
const BUNDLED_DEMO = join(SKILL, "demo");
const BUNDLED_TEMPLATE = join(SKILL, "template");
const DEMO_DATA = join("lib", "report-data.ts");

let cwd: string;

beforeEach(() => {
  cwd = freshTestDir(import.meta.path);
});

function writeFiles(root: string, files: Record<string, string>): void {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(resolve(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), content);
  }
}

function filesUnder(root: string): string[] {
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name).slice(root.length + 1))
    .sort();
}

describe("generate-pdf --demo", () => {
  test("parseArgs accepts --demo with no report folder", () => {
    expect(parseArgs(["--demo"]).demo).toBe(true);
  });

  test("parseArgs keeps --demo when a report folder is also given", () => {
    expect(parseArgs(["some-folder", "--demo"]).demo).toBe(true);
    expect(parseArgs(["--demo", "some-folder"]).demo).toBe(true);
  });

  test("parseArgs without --demo still takes the report folder", () => {
    const opts = parseArgs(["my-report", "--skip-build"]);
    expect(opts.reportDir).toBe("my-report");
    expect(opts.demo).toBeFalsy();
  });

  test("the bundled demo holds only its report data, the template supplies the rest", () => {
    expect(filesUnder(BUNDLED_DEMO)).toEqual([DEMO_DATA]);
  });

  test("--demo builds consulting-report-demo from the template with the demo's data", async () => {
    const target = await prepareDemo(cwd);

    expect(resolve(target)).toBe(join(cwd, "consulting-report-demo"));
    expect(readFileSync(join(target, "package.json"), "utf-8")).toBe(
      readFileSync(join(BUNDLED_TEMPLATE, "package.json"), "utf-8")
    );
    expect(existsSync(join(target, "lib", "types.ts"))).toBe(true);
    expect(readFileSync(join(target, DEMO_DATA), "utf-8")).toBe(
      readFileSync(join(BUNDLED_DEMO, DEMO_DATA), "utf-8")
    );
  });

  test("--demo leaves an existing consulting-report-demo folder as it is, run twice", async () => {
    const existing = join(cwd, "consulting-report-demo");
    mkdirSync(existing);
    writeFileSync(join(existing, "edited.txt"), "mine");

    await prepareDemo(cwd);
    await prepareDemo(cwd);

    expect(readFileSync(join(existing, "edited.txt"), "utf-8")).toBe("mine");
    expect(existsSync(join(existing, "package.json"))).toBe(false);
  });

  test("a second --demo run does not overwrite edits to the copy", async () => {
    await prepareDemo(cwd);
    const copied = join(cwd, "consulting-report-demo", DEMO_DATA);
    writeFileSync(copied, "edited");

    await prepareDemo(cwd);

    expect(readFileSync(copied, "utf-8")).toBe("edited");
  });

  test("--demo leaves build output and installed dependencies behind in both sources", async () => {
    const template = join(cwd, "template");
    const demo = join(cwd, "demo");
    writeFiles(template, {
      "package.json": "{}",
      "lib/report-data.ts": "placeholder",
      "node_modules/next/index.js": "",
      ".next/cache/x": "",
      "out/index.html": "",
    });
    writeFiles(demo, {
      "lib/report-data.ts": "demo",
      "node_modules/stale/index.js": "",
      "out/index.html": "",
    });

    const target = await prepareDemo(join(cwd, "work"), { template, demo });

    expect(readFileSync(join(target, "package.json"), "utf-8")).toBe("{}");
    expect(readFileSync(join(target, DEMO_DATA), "utf-8")).toBe("demo");
    expect(existsSync(join(target, "node_modules"))).toBe(false);
    expect(existsSync(join(target, ".next"))).toBe(false);
    expect(existsSync(join(target, "out"))).toBe(false);
  });

  test("it does not modify the bundled demo or template", async () => {
    const demoBefore = readFileSync(join(BUNDLED_DEMO, DEMO_DATA), "utf-8");
    const templateBefore = readFileSync(join(BUNDLED_TEMPLATE, DEMO_DATA), "utf-8");

    await prepareDemo(cwd);

    expect(readFileSync(join(BUNDLED_DEMO, DEMO_DATA), "utf-8")).toBe(demoBefore);
    expect(readFileSync(join(BUNDLED_TEMPLATE, DEMO_DATA), "utf-8")).toBe(templateBefore);
  });
});
