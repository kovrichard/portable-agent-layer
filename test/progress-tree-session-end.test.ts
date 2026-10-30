import { describe, expect, test } from "bun:test";
import { appendEvent } from "../src/hooks/lib/progress-tree";
import { recordWhereSessionStopped } from "../src/hooks/lib/progress-tree-session-end";
import {
  openNode,
  paths,
  SESSION,
  scope,
  setting,
  startEachTestInAFreshHome,
  tree,
} from "./lib/progress-tree-auto-attach-fixture";

startEachTestInAFreshHome(import.meta.file);

const NOTE = {
  title: "Handoff wiring",
  done: "Traced where the handoff is written.",
  next: "Run the gates.",
  waitingOn: "",
};

const stopAt = (note: Partial<typeof NOTE> = {}) =>
  recordWhereSessionStopped(paths.folder, SESSION, { ...NOTE, ...note });

const onlyNode = () => {
  const nodes = [...tree().nodes.values()];
  expect(nodes).toHaveLength(1);
  return nodes[0];
};

describe("the session's summary lands on its node as stopped-at", () => {
  test("the active node takes the next step", () => {
    openNode();
    stopAt();
    expect(onlyNode().stoppedAt).toBe("Next: Run the gates.");
  });

  test("what the session waits on joins the next step, and the node stays active", () => {
    openNode();
    stopAt({ waitingOn: "Rico picks the base branch." });
    expect(onlyNode()).toMatchObject({
      status: "active",
      stoppedAt: "Next: Run the gates. · Waiting on you: Rico picks the base branch.",
    });
  });

  test("with nothing left to do, it says what was done", () => {
    openNode();
    stopAt({ next: "" });
    expect(onlyNode().stoppedAt).toBe("Done: Traced where the handoff is written.");
  });

  test("a session with no node opens one under the session's title", () => {
    stopAt();
    expect(onlyNode()).toMatchObject({
      title: "Handoff wiring",
      stoppedAt: "Next: Run the gates.",
    });
    expect(tree().active).toBe(onlyNode().id);
  });

  test("a later summary replaces the earlier one", () => {
    openNode();
    stopAt();
    stopAt({ next: "Open the PR." });
    expect(onlyNode().stoppedAt).toBe("Next: Open the PR.");
  });
});

describe("what it leaves alone", () => {
  test("a stopped-at recorded by hand in this session wins", () => {
    openNode();
    appendEvent(
      scope(),
      "n1",
      "stopped",
      { text: "By hand." },
      undefined,
      undefined,
      SESSION
    );
    stopAt();
    expect(onlyNode().stoppedAt).toBe("By hand.");
  });

  test("a stopped-at recorded by hand in another session does not", () => {
    openNode();
    appendEvent(
      scope(),
      "n1",
      "stopped",
      { text: "Old." },
      undefined,
      undefined,
      "other"
    );
    stopAt();
    expect(onlyNode().stoppedAt).toBe("Next: Run the gates.");
  });

  test("an empty summary writes nothing", () => {
    stopAt({ done: "", next: "", waitingOn: "" });
    expect(tree().nodes.size).toBe(0);
  });

  test("an install still holding the old off switch records anyway", () => {
    setting(false);
    stopAt();
    expect(onlyNode().stoppedAt).toBe("Next: Run the gates.");
  });
});
