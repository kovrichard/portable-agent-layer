import { beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  parseArgs,
  prepareDemo,
} from "../assets/skills/consulting-report/tools/generate-pdf";
import { freshTestDir } from "./lib/test-home";

const BUNDLED_DEMO = resolve(import.meta.dir, "../assets/skills/consulting-report/demo");

let cwd: string;

beforeEach(() => {
  cwd = freshTestDir(import.meta.path);
});

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

  test("--demo copies the bundled demo into consulting-report-demo in the current directory", async () => {
    const target = await prepareDemo(cwd);

    expect(resolve(target)).toBe(join(cwd, "consulting-report-demo"));
    expect(existsSync(join(cwd, "consulting-report-demo", "package.json"))).toBe(true);
    expect(
      readFileSync(join(cwd, "consulting-report-demo", "package.json"), "utf-8")
    ).toBe(readFileSync(join(BUNDLED_DEMO, "package.json"), "utf-8"));
    expect(existsSync(join(cwd, "consulting-report-demo", "lib"))).toBe(true);
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
    const copied = join(cwd, "consulting-report-demo", "package.json");
    writeFileSync(copied, "edited");

    await prepareDemo(cwd);

    expect(readFileSync(copied, "utf-8")).toBe("edited");
  });

  test("it does not modify the bundled demo", async () => {
    const before = readFileSync(join(BUNDLED_DEMO, "package.json"), "utf-8");
    await prepareDemo(cwd);
    expect(readFileSync(join(BUNDLED_DEMO, "package.json"), "utf-8")).toBe(before);
  });
});
