import { beforeEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { dependencyInstall } from "../src/cli/dependencies";
import { freshTestDir } from "./lib/test-home";

let PKG: string;

beforeEach(() => {
  PKG = freshTestDir(import.meta.file);
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
