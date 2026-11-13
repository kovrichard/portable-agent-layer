import { beforeEach, spyOn } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { type ProjectProgress, writeProject } from "../../src/hooks/lib/projects";
import { reload } from "../../src/hooks/lib/settings";
import { run } from "../../src/tools/agent/project";
import { fakeProject } from "./projects-lib-fixture";
import { freshTestDir } from "./test-home";

export const SEEDED_AT = "2026-05-04T10:00:00Z";

export interface ProjectCliRun {
  code: number;
  stdout: string;
  stderr: string;
}

class ExitCalled extends Error {
  constructor(readonly code: number) {
    super(`process.exit(${code})`);
  }
}

/** A fresh PAL home per test, so projects, events and work folders never leak between tests. */
export function projectCliHome(file: string): () => string {
  let home = "";
  beforeEach(() => {
    home = freshTestDir(file);
    process.env.PAL_HOME = home;
    reload();
  });

  return () => home;
}

export function seedProject(
  home: string,
  overrides: Partial<ProjectProgress> = {}
): void {
  writeProject(
    fakeProject({
      path: resolve(home, "no-such-checkout"),
      updated: SEEDED_AT,
      ...overrides,
    })
  );
}

/** Runs `pal cli project …` in-process, with stdout, stderr and process.exit captured. */
export async function projectCli(...args: string[]): Promise<ProjectCliRun> {
  const out: string[] = [];
  const err: string[] = [];
  const log = spyOn(console, "log").mockImplementation((line) => out.push(String(line)));
  const error = spyOn(console, "error").mockImplementation((line) =>
    err.push(String(line))
  );
  const stderr = spyOn(process.stderr, "write").mockImplementation((chunk) => {
    err.push(String(chunk));

    return true;
  });
  const exit = spyOn(process, "exit").mockImplementation((code) => {
    throw new ExitCalled(Number(code));
  });

  try {
    const code = await run(args);

    return { code, stdout: out.join("\n"), stderr: err.join("") };
  } catch (thrown) {
    if (!(thrown instanceof ExitCalled)) throw thrown;

    return { code: thrown.code, stdout: out.join("\n"), stderr: err.join("") };
  } finally {
    log.mockRestore();
    error.mockRestore();
    stderr.mockRestore();
    exit.mockRestore();
  }
}

export async function projectCliJson(
  ...args: string[]
): Promise<Record<string, unknown>> {
  const result = await projectCli(...args);
  if (result.code !== 0) throw new Error(`exit ${result.code}: ${result.stderr}`);

  return JSON.parse(result.stdout);
}

export function commitmentEvents(home: string): Record<string, unknown>[] {
  const file = resolve(
    home,
    "memory",
    "events",
    `${new Date().toISOString().slice(0, 7)}.jsonl`
  );
  if (!existsSync(file)) return [];

  return readFileSync(file, "utf-8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
    .filter((event) => event.type === "commitment")
    .map(({ iscProject, isc, outcome, surface }) => ({
      iscProject,
      isc,
      outcome,
      surface,
    }));
}
