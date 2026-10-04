import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import {
  bindingFinding,
  stateFindings,
  unknownSettingsKeys,
  unresolvedDependencies,
} from "../src/cli/doctor/state";

let HOME: string;
let savedHome: string | undefined;

beforeEach(() => {
  HOME = mkdtempSync(resolve(tmpdir(), "pal-doctor-state-"));
  savedHome = process.env.PAL_HOME;
  process.env.PAL_HOME = HOME;
});

afterEach(() => {
  if (savedHome === undefined) delete process.env.PAL_HOME;
  else process.env.PAL_HOME = savedHome;
  rmSync(HOME, { recursive: true, force: true });
});

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function settings(value: unknown): void {
  write(
    resolve(HOME, "memory", "pal-settings.json"),
    typeof value === "string" ? value : JSON.stringify(value)
  );
}

const IDENTITY = { identity: { ai: { name: "A" }, principal: { name: "P" } } };

function healthyHome(): void {
  write(resolve(HOME, "telos", "GOALS.md"), "# Goals\n");
  settings(IDENTITY);
}

const byId = (id: string) => stateFindings().find((f) => f.id === id);

describe("PAL's own state", () => {
  test("no TELOS fails, with the command that scaffolds it", () => {
    settings(IDENTITY);

    expect(byId("telos.missing")?.severity).toBe("fail");
    expect(byId("telos.missing")?.fix?.command).toBe("pal cli init");
  });

  test("settings that are not valid JSON fail", () => {
    healthyHome();
    settings("{ broken");

    expect(byId("settings.unreadable")?.severity).toBe("fail");
  });

  test("an incomplete identity warns", () => {
    healthyHome();
    settings({ identity: { ai: { name: "A" } } });

    expect(byId("identity")?.severity).toBe("warn");
  });

  test("an unknown settings key warns and suggests the key it was likely meant to be", () => {
    healthyHome();
    settings({ ...IDENTITY, dynamicContext: { claimChek: true } });

    const finding = byId("settings.unknown");
    expect(finding?.severity).toBe("warn");
    expect(finding?.title).toContain(
      "dynamicContext.claimChek (did you mean claimCheck?)"
    );
  });

  test("several unknown keys are one warning that names each", () => {
    healthyHome();
    settings({ ...IDENTITY, dynamicContext: { retiredOne: true, retiredTwo: true } });

    const unknown = stateFindings().filter((f) => f.id === "settings.unknown");
    expect(unknown).toHaveLength(1);
    expect(unknown[0].title).toContain("2 settings");
    expect(unknown[0].title).toContain("dynamicContext.retiredTwo");
  });

  test("valid settings raise nothing", () => {
    healthyHome();
    settings({ ...IDENTITY, dynamicContext: { claimCheck: false } });

    expect(
      stateFindings().filter((f) => f.severity === "fail" || f.severity === "warn")
    ).toEqual([]);
  });
});

describe("PAL's dependencies", () => {
  function pkgWithDeps(deps: string[], hoisted: string[]): string {
    const pkg = resolve(HOME, "global", "node_modules", "portable-agent-layer");
    write(
      resolve(pkg, "package.json"),
      JSON.stringify({ dependencies: Object.fromEntries(deps.map((d) => [d, "1"])) })
    );
    for (const name of hoisted) {
      write(
        resolve(HOME, "global", "node_modules", name, "package.json"),
        JSON.stringify({ name, main: "index.js" })
      );
      write(resolve(HOME, "global", "node_modules", name, "index.js"), "");
    }
    return pkg;
  }

  test("dependencies hoisted beside a global install count as installed", () => {
    expect(unresolvedDependencies(pkgWithDeps(["alpha"], ["alpha"]))).toEqual([]);
  });

  test("names each dependency that does not resolve", () => {
    expect(unresolvedDependencies(pkgWithDeps(["alpha", "beta"], ["alpha"]))).toEqual([
      "beta",
    ]);
  });
});

describe("project bindings", () => {
  test("a project not checked out here gets the set-path command", () => {
    const finding = bindingFinding({ kind: "unlocatable", project: "alpha" });

    expect(finding.severity).toBe("warn");
    expect(finding.title).toContain("not checked out");
    expect(finding.fix?.command).toBe("pal cli project set-path alpha <path>");
  });

  test("a collision names both projects", () => {
    const finding = bindingFinding({
      kind: "shared",
      path: "/w/t",
      projects: ["orbit", "orbit-internal"],
    });

    expect(finding.title).toContain("orbit and orbit-internal");
    expect(finding.fix?.command).toBe("pal cli project set-path orbit <path>");
  });
});

describe("unknown settings keys", () => {
  const schema = {
    type: "object",
    additionalProperties: true,
    properties: {
      section: {
        type: "object",
        additionalProperties: false,
        properties: {
          enabled: { type: "boolean" },
          rules: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: { tag: { type: "string" } },
            },
          },
        },
      },
      free: { type: "object", additionalProperties: true },
    },
  };

  test("finds keys a section does not declare, at any depth", () => {
    expect(
      unknownSettingsKeys(
        { section: { enabeld: true, rules: [{ tag: "a", tgs: "b" }] } },
        schema
      ).map((k) => k.path)
    ).toEqual(["section.enabeld", "section.rules[0].tgs"]);
  });

  test("suggests the closest declared key", () => {
    expect(
      unknownSettingsKeys({ section: { enabeld: true } }, schema)[0].suggestion
    ).toBe("enabled");
  });

  test("leaves sections that allow any key alone", () => {
    expect(unknownSettingsKeys({ anything: 1, free: { whatever: 2 } }, schema)).toEqual(
      []
    );
  });

  test("has no suggestion when nothing is close", () => {
    expect(
      unknownSettingsKeys({ section: { somethingElse: 1 } }, schema)[0].suggestion
    ).toBeUndefined();
  });
});
