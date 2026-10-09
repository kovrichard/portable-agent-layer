import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Reaction } from "../src/hooks/lib/interaction-reaction";
import { keepSample, readSamples } from "../src/hooks/lib/interaction-samples";
import {
  blindSamples,
  compareLabels,
  loadReactionAuditNudge,
  unauditedSamples,
  writeAuditMark,
} from "../src/hooks/lib/reaction-audit";
import { reload } from "../src/hooks/lib/settings";
import { removeOnceReleased } from "./lib/remove-once-released";
import { freshTestDir } from "./lib/test-home";

const REPO_ROOT = resolve(import.meta.dir, "..");
const T0 = new Date("2026-09-10T10:00:00Z");
let TEST_HOME: string;

function at(sec: number): Date {
  return new Date(T0.getTime() + sec * 1000);
}

function addSamples(reaction: Reaction, count: number, fromSec: number) {
  for (let i = 0; i < count; i++)
    keepSample({
      ts: at(fromSec + i).toISOString(),
      session: "s1",
      reaction,
      text: `msg ${fromSec + i}`,
      replyEnd: "Should I push?",
    });
}

beforeEach(() => {
  TEST_HOME = freshTestDir(import.meta.file);
  process.env.PAL_HOME = TEST_HOME;
  process.env.PAL_PKG = REPO_ROOT;
  mkdirSync(resolve(TEST_HOME, "memory", "state"), { recursive: true });
  writeFileSync(resolve(TEST_HOME, "memory", "pal-settings.json"), "{}");
  reload();
});

afterEach(() => {
  delete process.env.PAL_HOME;
  delete process.env.PAL_PKG;
  reload();
  removeOnceReleased(TEST_HOME);
});

describe("audit samples", () => {
  test("the model sees the message and reply end, never the rule's label", () => {
    addSamples("approved", 1, 0);

    expect(blindSamples(readSamples())).toEqual([
      { id: at(0).toISOString(), text: "msg 0", replyEnd: "Should I push?" },
    ]);
  });

  test("only samples newer than the last audit are offered", () => {
    addSamples("follow-up", 3, 0);
    writeAuditMark(at(10));
    addSamples("follow-up", 2, 20);

    expect(unauditedSamples().map((s) => s.text)).toEqual(["msg 20", "msg 21"]);
    expect(unauditedSamples(null)).toHaveLength(5);
  });

  test("reports where the model and the rules disagree", () => {
    addSamples("follow-up", 2, 0);
    const [first, second] = readSamples();

    const result = compareLabels(readSamples(), {
      [first.ts]: "follow-up",
      [second.ts]: "approved",
    });

    expect(result).toEqual({
      compared: 2,
      agreed: 1,
      disagreements: [
        expect.objectContaining({ text: "msg 1", rule: "follow-up", model: "approved" }),
      ],
    });
  });

  test("samples the model did not label are left out", () => {
    addSamples("follow-up", 3, 0);

    expect(compareLabels(readSamples(), {}).compared).toBe(0);
  });
});

describe("audit due notice", () => {
  test("fires once enough new samples build up", () => {
    addSamples("follow-up", 39, 0);
    expect(loadReactionAuditNudge(TEST_HOME)).toBe("");

    addSamples("follow-up", 1, 100);
    expect(loadReactionAuditNudge(TEST_HOME)).toContain("40 new labelled messages");
  });

  test("fires early when the follow-up share drifts", () => {
    addSamples("approved", 20, 0);
    writeAuditMark(at(50));
    addSamples("follow-up", 20, 100);

    expect(loadReactionAuditNudge(TEST_HOME)).toContain("moved from 0% to 100%");
  });

  test("stays quiet when the share holds", () => {
    addSamples("follow-up", 20, 0);
    writeAuditMark(at(50));
    addSamples("follow-up", 20, 100);

    expect(loadReactionAuditNudge(TEST_HOME)).toBe("");
  });

  test("never shows outside a PAL checkout", () => {
    process.env.PAL_PKG = TEST_HOME;
    addSamples("follow-up", 60, 0);

    expect(loadReactionAuditNudge(TEST_HOME)).toBe("");
  });
});
