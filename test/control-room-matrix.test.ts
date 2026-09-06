import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  buildMatrix,
  type Matrix,
  type MatrixItem,
  matrix,
} from "../src/tools/control-room/matrix";

// Every placement on the morning screen has to be defensible from files alone,
// so each rule that can move an item between quadrants gets its own fixture.

const NOW = new Date("2026-09-05T12:00:00.000Z");
let HOME: string;

beforeEach(() => {
  HOME = mkdtempSync(resolve(tmpdir(), "pal-matrix-"));
  process.env.PAL_HOME = HOME;
});

afterEach(() => {
  delete process.env.PAL_HOME;
  rmSync(HOME, { recursive: true, force: true });
});

interface ProjectFixture {
  status?: string;
  updated?: string;
  serves?: string;
  servesBy?: string;
  servesNote?: string;
  blockers?: string[];
  next?: string[];
}

function registerProject(slug: string, opts: ProjectFixture = {}): string {
  const path = resolve(HOME, "work", slug);
  mkdirSync(path, { recursive: true });
  mkdirSync(resolve(HOME, "memory", "projects", slug), { recursive: true });
  const front = [
    `name: ${slug}`,
    `status: ${opts.status ?? "active"}`,
    "created: 2026-08-01T00:00:00.000Z",
    `updated: ${opts.updated ?? "2026-09-04T00:00:00.000Z"}`,
    `path: ${path}`,
    opts.serves ? `serves: ${opts.serves}` : "",
    opts.servesBy ? `serves_by: ${opts.servesBy}` : "",
    opts.servesNote ? `serves_note: ${opts.servesNote}` : "",
    opts.blockers ? `blockers: ${JSON.stringify(opts.blockers)}` : "",
    opts.next ? `next: ${JSON.stringify(opts.next)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  writeFileSync(
    resolve(HOME, "memory", "projects", slug, "ISA.md"),
    `---\n${front}\n---\n\n## Goal\n\nnone\n`,
    "utf-8"
  );
  return path;
}

function writeGoals(content: string): void {
  mkdirSync(resolve(HOME, "telos"), { recursive: true });
  writeFileSync(resolve(HOME, "telos", "GOALS.md"), content, "utf-8");
}

function writeHandoff(path: string, entry: Record<string, unknown>): void {
  const dir = resolve(HOME, "memory", "state");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    resolve(dir, "last-handoff.json"),
    JSON.stringify({
      [path]: {
        timestamp: "2026-09-04T18:00:00.000Z",
        title: "the title",
        status: "in-progress",
        handoff: "unfinished",
        artifacts: [],
        source: "deliberate",
        ...entry,
      },
    }),
    "utf-8"
  );
}

function find(grid: Matrix, id: string): { quadrant: string; item: MatrixItem } {
  for (const quadrant of ["now", "plan", "noise", "later"] as const) {
    const item = grid[quadrant].find((i) => i.id === id);
    if (item) return { quadrant, item };
  }
  throw new Error(`${id} is in no quadrant`);
}

describe("buildMatrix", () => {
  function item(overrides: Partial<MatrixItem>): MatrixItem {
    return {
      kind: "project",
      id: "x",
      label: "x",
      detail: "",
      urgent: false,
      important: false,
      placed: null,
      urgentBecause: [],
      importantBecause: "",
      serves: null,
      servesBy: null,
      due: null,
      waitingOn: null,
      ...overrides,
    };
  }

  test("the two flags decide the quadrant", () => {
    const grid = buildMatrix(
      [
        item({ id: "a", urgent: true, important: true }),
        item({ id: "b", urgent: false, important: true }),
        item({ id: "c", urgent: true, important: false }),
        item({ id: "d", urgent: false, important: false }),
      ],
      0
    );
    expect(grid.now.map((i) => i.id)).toEqual(["a"]);
    expect(grid.plan.map((i) => i.id)).toEqual(["b"]);
    expect(grid.noise.map((i) => i.id)).toEqual(["c"]);
    expect(grid.later.map((i) => i.id)).toEqual(["d"]);
  });

  test("within a quadrant, more reasons come first, then alphabetically", () => {
    const grid = buildMatrix(
      [
        item({ id: "zeta", label: "zeta", urgent: true, urgentBecause: ["one"] }),
        item({ id: "alpha", label: "alpha", urgent: true, urgentBecause: ["one"] }),
        item({
          id: "loud",
          label: "loud",
          urgent: true,
          urgentBecause: ["one", "two"],
        }),
      ],
      0
    );
    expect(grid.noise.map((i) => i.id)).toEqual(["loud", "alpha", "zeta"]);
  });

  test("the unranked count is carried through untouched", () => {
    expect(buildMatrix([], 7).unranked).toBe(7);
  });
});

describe("importance", () => {
  test("a goal and a revenue bet are important, fun is not", () => {
    registerProject("serious", { serves: "goal" });
    registerProject("bet", { serves: "revenue" });
    registerProject("toy", { serves: "fun" });
    const grid = matrix(NOW);
    expect(find(grid, "serious").item.important).toBe(true);
    expect(find(grid, "bet").item.important).toBe(true);
    expect(find(grid, "toy").item.important).toBe(false);
  });

  test("a quiet revenue bet lands in important-but-not-urgent, on the record's word alone", () => {
    registerProject("some-side-product", {
      serves: "revenue",
      servesNote: "a SaaS bet",
    });
    const { quadrant, item } = find(matrix(NOW), "some-side-product");
    expect(quadrant).toBe("plan");
    expect(item.importantBecause).toBe("a way this could pay");
    expect(item.detail).toBe("a SaaS bet");
  });

  test("a project with no purpose on record says so and counts as unranked", () => {
    registerProject("unknown");
    const grid = matrix(NOW);
    expect(grid.unranked).toBe(1);
    const { item } = find(grid, "unknown");
    expect(item.important).toBe(false);
    expect(item.importantBecause).toContain("no purpose on record");
  });

  test("a stated goal is important without being a project", () => {
    writeGoals("# Goals\n\n- Find three clients\n");
    const { quadrant, item } = find(matrix(NOW), "find-three-clients");
    expect(quadrant).toBe("plan");
    expect(item.kind).toBe("goal");
    expect(item.importantBecause).toBe("a goal you stated");
  });

  test("the user's answer is reported as theirs, not as a guess", () => {
    registerProject("mine", { serves: "fun", servesBy: "user" });
    const { item } = find(matrix(NOW), "mine");
    expect(item.serves).toBe("fun");
    expect(item.servesBy).toBe("user");
  });
});

describe("urgency", () => {
  test("a blocker is urgent and says how many", () => {
    registerProject("blocked", { serves: "goal", blockers: ["waiting on DNS"] });
    const { quadrant, item } = find(matrix(NOW), "blocked");
    expect(quadrant).toBe("now");
    expect(item.urgentBecause).toContain("1 blocker");
  });

  test("a dated next step inside the window is urgent, one beyond it is not", () => {
    registerProject("soon", { serves: "goal", next: ["file the form by 2026-09-10"] });
    registerProject("later", { serves: "goal", next: ["review in December 2026"] });
    expect(find(matrix(NOW), "soon").item.urgentBecause).toContain(
      "next step dated 2026-09-10"
    );
    expect(find(matrix(NOW), "later").item.urgent).toBe(false);
  });

  test("waiting on the human outranks a plain unfinished handoff", () => {
    const path = registerProject("stuck", { serves: "goal" });
    writeHandoff(path, { waitingOn: "a decision on pricing" });
    const { item } = find(matrix(NOW), "stuck");
    expect(item.waitingOn).toBe("a decision on pricing");
    expect(item.urgentBecause).toContain("waiting on you");
    expect(item.urgentBecause).not.toContain("handoff in progress");
  });

  test("an unfinished handoff with nobody blocked is still urgent", () => {
    const path = registerProject("midway", { serves: "goal" });
    writeHandoff(path, {});
    expect(find(matrix(NOW), "midway").item.urgentBecause).toEqual([
      "handoff in progress",
    ]);
  });

  test("an important project going quiet is urgent; a fun one is just quiet", () => {
    registerProject("rotting", { serves: "goal", updated: "2026-07-01T00:00:00.000Z" });
    registerProject("dormant", { serves: "fun", updated: "2026-07-01T00:00:00.000Z" });
    expect(find(matrix(NOW), "rotting").item.urgentBecause).toEqual(["gone quiet"]);
    expect(find(matrix(NOW), "dormant").item.urgent).toBe(false);
  });

  test("a paused project cannot go quiet — pausing it was the decision", () => {
    registerProject("parked", {
      serves: "goal",
      status: "paused",
      updated: "2026-07-01T00:00:00.000Z",
    });
    expect(find(matrix(NOW), "parked").quadrant).toBe("plan");
  });

  test("a dated goal becomes urgent as its date approaches", () => {
    writeGoals("# Goals\n\n- Be hired by 2026-09-12\n- Learn to sail one day\n");
    const grid = matrix(NOW);
    expect(find(grid, "be-hired-by-20260912").item.urgentBecause).toEqual([
      "dated 2026-09-12",
    ]);
    expect(find(grid, "learn-to-sail-one-day").item.urgent).toBe(false);
  });
});

describe("what the grid covers", () => {
  test("finished and abandoned projects are off the morning screen", () => {
    registerProject("done", { status: "completed", serves: "goal" });
    registerProject("dropped", { status: "abandoned", serves: "goal" });
    registerProject("live", { serves: "goal" });
    const grid = matrix(NOW);
    const ids = [...grid.now, ...grid.plan, ...grid.noise, ...grid.later].map(
      (i) => i.id
    );
    expect(ids).toEqual(["live"]);
  });

  test("nothing registered is four empty quadrants, not a throw", () => {
    expect(matrix(NOW)).toEqual({
      now: [],
      plan: [],
      noise: [],
      later: [],
      unranked: 0,
    });
  });
});
