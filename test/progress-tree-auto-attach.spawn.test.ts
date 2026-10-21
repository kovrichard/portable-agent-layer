import { describe, expect, test } from "bun:test";
import { stopProgressTree } from "../src/hooks/lib/progress-tree-gate";
import {
  attach,
  attachments,
  factoryEvent,
  nodeHoldingTask,
  PR,
  SESSION,
  sessionStart,
  startEachTestInAFreshHome,
  TASK,
} from "./lib/progress-tree-auto-attach-fixture";

startEachTestInAFreshHome(import.meta.file);

describe("the factory's PR reaches the node holding the task", () => {
  const endOfTurn = () => stopProgressTree({ session_id: SESSION });

  test.each([
    "pr_opened",
    "pr_adopted",
  ])("%s attaches at the end of a turn", async (event) => {
    nodeHoldingTask();
    factoryEvent(event, TASK);
    await endOfTurn();
    expect(attachments()).toContainEqual(["n1", "pr", PR]);
  });

  test("a PR attached by hand is not attached again, across checks", async () => {
    nodeHoldingTask();
    attach("n1", "pr", PR);
    factoryEvent("pr_opened", TASK);
    sessionStart();
    await endOfTurn();
    await endOfTurn();
    expect(attachments().filter(([, kind]) => kind === "pr")).toEqual([["n1", "pr", PR]]);
  });

  test("repeated checks attach the PR once", async () => {
    nodeHoldingTask();
    factoryEvent("pr_opened", TASK);
    sessionStart();
    sessionStart();
    await endOfTurn();
    expect(attachments().filter(([, kind]) => kind === "pr")).toEqual([["n1", "pr", PR]]);
  });
});
