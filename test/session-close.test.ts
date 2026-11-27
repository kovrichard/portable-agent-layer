import { describe, expect, test } from "bun:test";
import { closeSession, type SessionCloseSteps } from "../src/hooks/lib/session-close";

function recordingSteps(stage: () => unknown) {
  const calls: string[] = [];
  const steps: SessionCloseSteps = {
    logEnd: (input) => calls.push(`logEnd:${input?.reason}`),
    autoUpdate: (reason) => calls.push(`autoUpdate:${reason}`),
    startSync: () => calls.push("startSync"),
    spawnPreserve: () => calls.push("spawnPreserve"),
    stageTranscript: (path) => {
      calls.push(`stage:${path}`);

      return stage();
    },
  };

  return { calls, steps };
}

const input = { reason: "prompt_input_exit", transcript_path: "/p/s.jsonl" };

describe("closeSession", () => {
  test("logs the end, updates and starts sync before the transcript copy begins", () => {
    let doneBeforeCopy: string[] = [];
    const { calls, steps } = recordingSteps(() => {
      doneBeforeCopy = [...calls];
    });
    closeSession(input, steps);
    expect(doneBeforeCopy).toEqual([
      "logEnd:prompt_input_exit",
      "autoUpdate:prompt_input_exit",
      "startSync",
      "spawnPreserve",
      "stage:/p/s.jsonl",
    ]);
  });

  test("a copy that throws loses nothing that ran before it", () => {
    const { calls, steps } = recordingSteps(() => {
      throw new Error("disk full");
    });
    expect(() => closeSession(input, steps)).not.toThrow();
    expect(calls).toContain("logEnd:prompt_input_exit");
    expect(calls).toContain("startSync");
  });

  test("a payload that could not be read still runs every step", () => {
    const { calls, steps } = recordingSteps(() => null);
    closeSession(null, steps);
    expect(calls).toEqual([
      "logEnd:undefined",
      "autoUpdate:undefined",
      "startSync",
      "spawnPreserve",
      "stage:undefined",
    ]);
  });

  test("a failing end log still spawns the sweep and copies the transcript", () => {
    const { calls, steps } = recordingSteps(() => null);
    steps.logEnd = () => {
      throw new Error("bronze locked");
    };
    steps.spawnPreserve = () => {
      calls.push("spawnPreserve");
      throw new Error("no bun");
    };
    closeSession(null, steps);
    expect(calls).toEqual(["spawnPreserve", "stage:undefined"]);
  });
});
