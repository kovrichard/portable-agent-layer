import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { dependencyInstall } from "../src/cli/dependencies";

let PKG: string;

beforeEach(() => {
  PKG = mkdtempSync(resolve(tmpdir(), "pal-dependency-install-"));
});

afterEach(() => {
  rmSync(PKG, { recursive: true, force: true });
});

function dependsOn(...names: string[]): void {
  const dependencies = Object.fromEntries(names.map((name) => [name, "*"]));
  writeFileSync(resolve(PKG, "package.json"), JSON.stringify({ dependencies }));
}

describe("installing PAL's dependencies", () => {
  test("a checkout installs exactly what its lockfile pins, dev tools included", () => {
    dependsOn();

    expect(dependencyInstall(PKG, true)).toEqual(["install", "--frozen-lockfile"]);
  });

  test("a package whose dependencies resolve installs nothing", () => {
    dependsOn();

    expect(dependencyInstall(PKG, false)).toBeNull();
  });

  test("a package missing a dependency installs production dependencies only", () => {
    dependsOn("pal-dependency-that-does-not-exist");

    expect(dependencyInstall(PKG, false)).toEqual(["install", "--production"]);
  });
});
