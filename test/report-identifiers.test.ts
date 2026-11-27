import { beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir, hostname, userInfo } from "node:os";
import { resolve } from "node:path";
import { reload } from "../src/core/settings";
import { getOrCreate, save } from "../src/knowledge/lib";
import { writeProject } from "../src/progress/projects";
import { machineIdentifiers } from "../src/report/leaks";
import { freshTestDir } from "./lib/test-home";

let HOME: string;

beforeEach(() => {
  HOME = resolve(freshTestDir(import.meta.file), "home");
  process.env.PAL_HOME = HOME;
  mkdirSync(resolve(HOME, "memory"), { recursive: true });
  writeFileSync(
    resolve(HOME, "memory", "pal-settings.json"),
    JSON.stringify({ identity: { principal: { name: "Ada Lovelace" } } })
  );
  reload();
});

const git = (values: Record<string, string>) => (key: string) => values[key] ?? "";

function project(name: string, extra: { path?: string; remote?: string } = {}) {
  const now = "2026-11-01T00:00:00Z";
  writeProject({ name, status: "active", created: now, updated: now, ...extra });
}

const wordsOf = (kind: string) =>
  machineIdentifiers(git({ "user.name": "Ada L", "user.email": "ada@corp.dev" }))
    .words.filter((word) => word.kind === kind)
    .map((word) => word.value);

describe("machineIdentifiers", () => {
  test("names the home, the account, the host, the person and git's email", () => {
    const ids = machineIdentifiers(
      git({ "user.name": "Ada L", "user.email": "ada@corp.dev" })
    );

    expect(ids.home).toBe(homedir());
    expect(ids.words).toEqual(
      expect.arrayContaining([
        { kind: "user-name", value: userInfo().username },
        { kind: "host-name", value: hostname() },
        { kind: "user-name", value: "Ada Lovelace" },
        { kind: "user-name", value: "Ada L" },
        { kind: "email", value: "ada@corp.dev" },
      ])
    );
  });

  test("drops values too short to be an identifier, such as an unset git name", () => {
    const ids = machineIdentifiers(git({ "user.name": "Al" }));

    expect(ids.words.some((word) => word.value === "Al" || word.value === "")).toBe(
      false
    );
  });

  test("lists distinctive project names, folders and remotes, but not PAL's own", () => {
    project("acme-billing", { remote: "github.com/acme/billing" });
    project("health");
    project("longproject");
    project("portable-agent-layer", {
      remote: "github.com/kovrichard/portable-agent-layer",
    });

    expect(wordsOf("project").sort()).toEqual(["acme-billing", "longproject"]);
    expect(wordsOf("remote")).toEqual(["github.com/acme/billing"]);
  });

  test("lists the people and companies in the knowledge store", () => {
    save(getOrCreate({ domain: "People", name: "Grace Hopper" }));
    save(getOrCreate({ domain: "Companies", name: "Initech" }));
    save(getOrCreate({ domain: "Ideas", name: "Quiet idea" }));

    expect(wordsOf("person-or-company").sort()).toEqual(["Grace Hopper", "Initech"]);
  });
});
