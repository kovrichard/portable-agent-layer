import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import os, * as osNamespace from "node:os";
import { homedir } from "node:os";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { TEST_ROOT } from "./lib/test-home";

function insideTestRoot(path: string): boolean {
  const below = relative(TEST_ROOT, path);

  return below !== "" && !below.startsWith("..") && !isAbsolute(below);
}

describe("the user's real home, from inside a test", () => {
  test("homedir() is a folder under the test root, however it is imported", () => {
    expect(insideTestRoot(homedir())).toBe(true);
    expect(osNamespace.homedir()).toBe(homedir());
    expect(os.homedir()).toBe(homedir());
  });

  test("a write aimed at ~/.pal lands in the test root", () => {
    const probe = resolve(homedir(), ".pal", "probe.json");
    expect(insideTestRoot(probe)).toBe(true);

    mkdirSync(dirname(probe), { recursive: true });
    writeFileSync(probe, "{}");
  });
});
