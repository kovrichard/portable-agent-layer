import { describe, expect, test } from "bun:test";
import { withoutDecisions } from "../assets/plugins/dark-factory/scripts/task.mjs";

const GOAL = "# Task\n\n## Goal\n\nShip it.";

describe("withoutDecisions", () => {
  test("a spec without a Decisions section comes back unchanged", () => {
    expect(withoutDecisions(`${GOAL}\n`)).toBe(`${GOAL}\n`);
  });

  test("a trailing Decisions section is dropped", () => {
    const spec = `${GOAL}\n\n## Decisions\n\n- planner asked, PO answered\n`;
    expect(withoutDecisions(spec)).toBe(`${GOAL}\n\n`);
  });

  test("a Decisions section in the middle is dropped and the next section kept", () => {
    const spec = `${GOAL}\n\n## Decisions\n\n- one\n\n## Weakest assumption\n\nThat it works.\n`;
    expect(withoutDecisions(spec)).toBe(
      `${GOAL}\n\n## Weakest assumption\n\nThat it works.\n`
    );
  });

  test("appending a decision line does not change the result", () => {
    const spec = `${GOAL}\n\n## Decisions\n\n- one\n`;
    expect(withoutDecisions(`${spec}- two\n`)).toBe(withoutDecisions(spec));
  });

  test("a deeper heading inside Decisions stays part of it", () => {
    const spec = `${GOAL}\n\n## Decisions\n\n### From the build\n\n- one\n`;
    expect(withoutDecisions(spec)).toBe(`${GOAL}\n\n`);
  });

  test("only a heading named exactly Decisions counts", () => {
    const spec = `${GOAL}\n\n## Decisions made earlier\n\n- kept\n`;
    expect(withoutDecisions(spec)).toBe(spec);
  });
});
