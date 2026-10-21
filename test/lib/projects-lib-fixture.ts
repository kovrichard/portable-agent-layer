import { beforeAll, beforeEach } from "bun:test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import type { ProjectProgress } from "../../src/hooks/lib/projects";
import { removeOnceReleased } from "./remove-once-released";
import { testHome } from "./test-home";

/** This suite's PAL home, with its projects folder emptied before every test. */
export function projectsHome(file: string): string {
  const home = testHome(file);
  beforeAll(() => {
    process.env.PAL_HOME = home;
    removeOnceReleased(home);
    mkdirSync(home, { recursive: true });
  });
  beforeEach(() => {
    removeOnceReleased(resolve(home, "memory", "projects"));
  });
  return home;
}

export function fakeProject(overrides: Partial<ProjectProgress> = {}): ProjectProgress {
  return {
    name: "demo",
    path: "/tmp/demo",
    status: "active",
    created: "2026-05-04T10:00:00Z",
    updated: "2026-05-04T10:00:00Z",
    ...overrides,
  };
}
