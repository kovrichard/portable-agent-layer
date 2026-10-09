import { beforeEach, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { reinstallInFreshProcess } from "../src/cli/reinstall";
import { freshTestDir } from "./lib/test-home";

describe("reinstallInFreshProcess", () => {
  let dir: string;

  beforeEach(() => {
    dir = freshTestDir(import.meta.file);
  });

  function fakeEntry(body: string): string {
    const entry = resolve(dir, "entry.ts");
    writeFileSync(entry, body);
    return entry;
  }

  test("runs `cli install` from the given entry in a new process", () => {
    const seen = resolve(dir, "seen.json");
    const entry = fakeEntry(
      `import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(seen)}, JSON.stringify({ args: process.argv.slice(2), pid: process.pid }));\n`
    );

    expect(reinstallInFreshProcess(entry)).toBe(0);
    const { args, pid } = JSON.parse(readFileSync(seen, "utf-8"));
    expect(args).toEqual(["cli", "install"]);
    expect(pid).not.toBe(process.pid);
  });

  test("tells the install which version it updated from", () => {
    const entry = fakeEntry(
      `process.exit(process.env.PAL_UPDATED_FROM === "0.89.0" && process.env.PATH ? 0 : 1);\n`
    );

    expect(reinstallInFreshProcess(entry, { PAL_UPDATED_FROM: "0.89.0" })).toBe(0);
  });

  test("returns the install's exit code", () => {
    expect(reinstallInFreshProcess(fakeEntry("process.exit(7);\n"))).toBe(7);
  });

  test("sees an export the update added to a module this process already loaded", async () => {
    const lib = resolve(dir, "lib.ts");
    writeFileSync(lib, "export const old = 1;\n");
    await import(lib);
    writeFileSync(lib, "export const old = 1;\nexport const added = 2;\n");
    const entry = fakeEntry(
      `import { added } from "./lib";\nprocess.exit(added === 2 ? 0 : 1);\n`
    );

    expect(reinstallInFreshProcess(entry)).toBe(0);
  });
});
