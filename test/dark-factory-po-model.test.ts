import { describe, expect, test } from "bun:test";
import {
  poCommand,
  poModel,
  poUnattendedCommand,
} from "../assets/plugins/dark-factory/scripts/task.mjs";
import { FABLE_MODEL } from "../src/hooks/lib/models";
import { FACTORY_MODELS, ROLE_TIERS } from "../src/tools/dark-factory/stamp";

describe("the product owner's model", () => {
  test("the PO is the only role on the flagship tier", () => {
    const flagshipRoles = Object.keys(ROLE_TIERS).filter(
      (role) => ROLE_TIERS[role] === "flagship"
    );
    expect(flagshipRoles).toEqual(["po"]);
  });

  test("the flagship tier is Fable", () => {
    expect(FACTORY_MODELS.flagship).toBe(FABLE_MODEL);
  });

  test("poModel reads the model stamped into the PO's agent file", () => {
    expect(poModel()).toBe(FACTORY_MODELS.flagship);
  });

  test("poModel is undefined for a plugin folder without a PO agent file", () => {
    expect(poModel("/no/such/plugin")).toBeUndefined();
  });

  test("the interactive PO session starts on the given model", () => {
    expect(
      poCommand({
        id: "t1",
        worktree: "/w/t1",
        settingsFile: null,
        pluginDir: "/p",
        model: "m1",
      })
    ).toBe(
      'cd /w/t1 && claude --model m1 --setting-sources local --plugin-dir /p "/dark-factory:build-with-agents t1"'
    );
  });

  test("the unattended PO session starts on the given model", () => {
    const command = poUnattendedCommand({
      id: "t1",
      worktree: "/w/t1",
      settingsFile: null,
      pluginDir: "/p",
      taskDir: "/h/tasks/t1",
      model: "m1",
    });
    expect(command.startsWith("cd /w/t1 && claude -p --model m1 --setting-sources")).toBe(
      true
    );
  });
});
