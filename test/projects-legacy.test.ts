import { describe, expect, setSystemTime, test } from "bun:test";
import { legacyJsonToProgress } from "../src/hooks/lib/projects-legacy";

const NOW = new Date("2026-06-01T12:00:00.000Z");
const REQUIRED = { name: "old", path: "/repos/old", status: "active" } as const;

function convertedAtNow(raw: unknown) {
  setSystemTime(NOW);

  try {
    return legacyJsonToProgress(raw);
  } finally {
    setSystemTime();
  }
}

describe("legacyJsonToProgress", () => {
  test.each([
    null,
    "a string",
    42,
    Object.assign(function old() {}, { path: "/repos/old", status: "active" }),
    { path: "/repos/old", status: "active" },
    { name: "old", status: "active" },
    { name: "old", path: "/repos/old" },
  ])("refuses %p", (raw) => {
    expect(legacyJsonToProgress(raw)).toBeNull();
  });

  test("maps every legacy list onto its section", () => {
    expect(
      legacyJsonToProgress({
        ...REQUIRED,
        created: "2025-01-01T00:00:00Z",
        updated: "2025-02-01T00:00:00Z",
        facts: ["runs on Bun", "ships weekly"],
        objectives: ["fast", "small"],
        next_steps: ["write docs"],
        blockers: ["no CI"],
        decisions: [
          { ts: "2025-01-15T09:30:00Z", decision: "use YAML", rationale: "readable" },
          { ts: "2025-01-20T10:00:00Z", decision: "drop JSON", rationale: "legacy" },
        ],
      })
    ).toEqual({
      ...REQUIRED,
      created: "2025-01-01T00:00:00Z",
      updated: "2025-02-01T00:00:00Z",
      next: ["write docs"],
      blockers: ["no CI"],
      context: "runs on Bun\nships weekly",
      goal: "- fast\n- small",
      decisions: "- 2025-01-15: use YAML (readable)\n- 2025-01-20: drop JSON (legacy)",
    });
  });

  test.each([
    {},
    { facts: [], objectives: [], next_steps: [], blockers: [], decisions: [] },
  ])(
    "leaves out absent or empty lists and stamps missing times with now (%p)",
    (lists) => {
      expect(convertedAtNow({ ...REQUIRED, ...lists })).toEqual({
        ...REQUIRED,
        created: NOW.toISOString(),
        updated: NOW.toISOString(),
      });
    }
  );
});
