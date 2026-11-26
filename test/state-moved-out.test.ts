import { beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { movedOutOfState } from "../src/core/paths";
import { freshTestDir } from "./lib/test-home";

let home: string;
const adaptation = () => resolve(home, "memory", "adaptation");

beforeEach(() => {
  home = freshTestDir(import.meta.file);
  process.env.PAL_HOME = home;
});

function writeAt(dir: string, name: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, name), "[]");
}

describe("a file that left the state folder", () => {
  test("is written at its new place on a new install", () => {
    expect(movedOutOfState(adaptation(), "reaction-samples.json")).toBe(
      resolve(adaptation(), "reaction-samples.json")
    );
  });

  test("is read from memory/state until the owner's move takes it", () => {
    writeAt(resolve(home, "memory", "state"), "reaction-samples.json");

    expect(movedOutOfState(adaptation(), "reaction-samples.json")).toBe(
      resolve(home, "memory", "state", "reaction-samples.json")
    );
  });

  test("is read at its new place once it is there, even with an old copy left behind", () => {
    writeAt(resolve(home, "memory", "state"), "reaction-audit.json");
    writeAt(adaptation(), "reaction-audit.json");

    expect(movedOutOfState(adaptation(), "reaction-audit.json")).toBe(
      resolve(adaptation(), "reaction-audit.json")
    );
  });
});
