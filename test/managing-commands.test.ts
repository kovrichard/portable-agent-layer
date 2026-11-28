import { beforeEach, describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import { cliTree } from "../src/cli/tree";
import { MANAGING_COMMANDS } from "../src/safety/managing-commands";
import { checkBashCommand, checkFilePath } from "../src/safety/security";

beforeEach(() => {
  process.env.PAL_HOME = join(homedir(), ".pal");
});

const pal = (...parts: string[]) => join(homedir(), ".pal", ...parts);

describe("a refused write names the command that manages the path", () => {
  test.each([
    [pal("bindings.json"), "pal cli project bindings"],
    [pal("settings.json"), "pal cli settings set"],
    [pal("telos", "GOALS.md"), "pal cli skill run telos update-telos"],
    [pal("memory", "knowledge", "People", "ada.md"), "pal cli knowledge add"],
    [pal("work", "projects", "demo", "ISA.md"), "pal cli project"],
    [pal("state", "sync", "account.key"), "pal cli sync"],
  ])("%s", (path, command) => {
    expect(checkFilePath(path)).toBe(
      `~/.pal/${path.slice(pal().length + 1)} is protected — manage it with \`${command}\``
    );
  });

  test("the shell guard gives the same message", () => {
    expect(checkBashCommand("echo '{}' > ~/.pal/bindings.json")).toContain(
      "manage it with `pal cli project bindings`"
    );
  });

  test("a path no command manages keeps the generic hint", () => {
    expect(checkFilePath(pal("memory", "state", "x.json"))).toContain(
      "change it through pal cli"
    );
  });
});

test("every command in the table is a registered pal cli verb", () => {
  const verbs = Object.keys(cliTree({} as never).commands);

  for (const { command } of MANAGING_COMMANDS)
    expect(verbs).toContain(command.split(" ")[2]);
});
