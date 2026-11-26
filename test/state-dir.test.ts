import { beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { paths, stateDir } from "../src/core/paths";
import { freshTestDir } from "./lib/test-home";

let home: string;

beforeEach(() => {
  home = freshTestDir(import.meta.file);
  process.env.PAL_HOME = home;
});

describe("this machine's state folder", () => {
  test("a new install keeps it at the root", () => {
    expect(paths.state()).toBe(resolve(home, "state"));
    expect(existsSync(resolve(home, "memory", "state"))).toBe(false);
  });

  test("an install that has not moved yet keeps using memory/state and grows no second folder", () => {
    mkdirSync(resolve(home, "memory", "state"), { recursive: true });

    expect(paths.state()).toBe(resolve(home, "memory", "state"));
    expect(paths.progress()).toBe(resolve(home, "memory", "state", "progress"));
    expect(existsSync(resolve(home, "state"))).toBe(false);
  });

  test("once the root folder exists it wins over the old one", () => {
    mkdirSync(resolve(home, "memory", "state"), { recursive: true });
    mkdirSync(resolve(home, "state"), { recursive: true });

    expect(stateDir()).toBe(resolve(home, "state"));
  });
});
