import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { relative, resolve } from "node:path";

// Opening the page is not work on a project. Every GET route is swept here
// against a snapshot of the whole home, because `updated` is what tells you a
// project has gone quiet — and a screen that reads it would erase it.

let HOME: string;
let server: ReturnType<typeof Bun.serve> | null = null;

beforeEach(() => {
  HOME = mkdtempSync(resolve(tmpdir(), "pal-read-only-"));
  process.env.PAL_HOME = HOME;
  mkdirSync(resolve(HOME, "memory", "ledger"), { recursive: true });
  mkdirSync(resolve(HOME, "memory", "state"), { recursive: true });
});

afterEach(() => {
  server?.stop(true);
  server = null;
  delete process.env.PAL_HOME;
  rmSync(HOME, { recursive: true, force: true });
});

function registerProject(slug: string, updated: string, serves?: string): void {
  const dir = resolve(HOME, "memory", "projects", slug);
  mkdirSync(dir, { recursive: true });
  const front = [
    `name: ${slug}`,
    "status: active",
    "created: 2026-08-01T00:00:00.000Z",
    `updated: ${updated}`,
    `path: ${HOME}`,
    serves ? `serves: ${serves}` : "",
    'next: ["file the form by 2026-09-10"]',
  ]
    .filter(Boolean)
    .join("\n");
  writeFileSync(
    resolve(dir, "ISA.md"),
    `---\n${front}\n---\n\n## Goal\n\nnone\n`,
    "utf-8"
  );
}

/** Every file under a directory, by path relative to the home, with its bytes. */
function snapshot(dir: string = HOME): Map<string, string> {
  const files = new Map<string, string>();
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      for (const [k, v] of snapshot(full)) files.set(k, v);
    } else {
      files.set(relative(HOME, full), readFileSync(full, "utf-8"));
    }
  }
  return files;
}

/** The state the page renders — the only thing a reader could corrupt. */
function renderedState(): Map<string, string> {
  const scoped = new Map<string, string>();
  for (const dir of ["memory/projects", "memory/state", "telos"]) {
    for (const [k, v] of snapshot(resolve(HOME, dir))) scoped.set(k, v);
  }
  return scoped;
}

const GETS = [
  "/api/agenda",
  "/api/matrix",
  "/api/board",
  "/api/handoffs",
  "/api/signal",
  "/api/agents",
  "/api/ledger",
  "/api/projects",
  "/api/status",
];

describe("reading the morning screen writes nothing", () => {
  test("no route changes a byte of the home, however often it is polled", async () => {
    const stale = "2026-07-01T00:00:00.000Z";
    registerProject("quiet-and-important", stale, "goal");
    registerProject("quiet-and-fun", stale, "fun");
    registerProject("unranked", stale);
    writeFileSync(
      resolve(HOME, "memory", "state", "agenda.json"),
      JSON.stringify({ generatedAt: stale, moves: [{ move: "m", because: "b" }] }),
      "utf-8"
    );
    mkdirSync(resolve(HOME, "telos"), { recursive: true });
    writeFileSync(
      resolve(HOME, "telos", "GOALS.md"),
      "# Goals\n\n- Find three clients by 2026-09-30\n",
      "utf-8"
    );

    const { startControlRoom } = await import("../src/tools/control-room/server");
    server = startControlRoom(0);
    const base = `http://127.0.0.1:${server.port}`;

    const renderedBefore = renderedState();
    expect(renderedBefore.size).toBe(5);

    async function sweep(): Promise<void> {
      for (const route of GETS) {
        expect((await fetch(`${base}${route}`)).status).toBe(200);
      }
      expect((await fetch(`${base}/`)).status).toBe(200);
    }

    // The first sweep may mint this install's own identity, which is a
    // bootstrap, not a read. Everything after it must be inert.
    await sweep();
    expect(renderedState()).toEqual(renderedBefore);

    const homeAfterBootstrap = snapshot();
    await sweep();
    await sweep();
    expect(snapshot()).toEqual(homeAfterBootstrap);
  });

  test("the staleness it just rendered is still on disk afterwards", async () => {
    const stale = "2026-07-01T00:00:00.000Z";
    registerProject("quiet-and-important", stale, "goal");

    const { startControlRoom } = await import("../src/tools/control-room/server");
    server = startControlRoom(0);
    await fetch(`http://127.0.0.1:${server.port}/api/matrix`);

    const isa = readFileSync(
      resolve(HOME, "memory", "projects", "quiet-and-important", "ISA.md"),
      "utf-8"
    );
    expect(isa).toContain(`updated: ${stale}`);
  });
});
