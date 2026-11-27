import { beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { storeDir } from "../src/bronze/bronze";
import { appendImportLog } from "../src/bronze/import-log";
import { writeContextDigests } from "../src/hooks/handlers/context-digests";
import { queueForReview, type ReviewItem } from "../src/knowledge/entity-extraction";
import { pendingReviews, rejectReview } from "../src/knowledge/entity-review";
import { readCandidates, recordCandidate } from "../src/opinions/adaptation-candidates";
import { addDraft, decideRule, readRules } from "../src/opinions/adaptation-rules";
import { appendTurn, readTurns } from "../src/opinions/adaptation-turns";
import { writeBinding } from "../src/progress/bindings";
import { appendProjectHistory } from "../src/progress/work-tracking";
import { directoryStore } from "../src/sync/blob-store";
import { randomKey } from "../src/sync/crypto";
import { syncOnce } from "../src/sync/sync";
import { freshTestDir } from "./lib/test-home";

type Machine = "A" | "B";

let dir: string;
let account: Uint8Array<ArrayBuffer>;
const homes: Record<Machine, string> = { A: "", B: "" };
const quarantined: string[] = [];

beforeEach(() => {
  dir = freshTestDir(import.meta.file);
  homes.A = resolve(dir, "a");
  homes.B = resolve(dir, "b");
  account = randomKey();
  quarantined.length = 0;
});

function on<T>(machine: Machine, work: () => T): T {
  process.env.PAL_HOME = homes[machine];

  return work();
}

async function sync(machine: Machine): Promise<void> {
  process.env.PAL_HOME = homes[machine];
  const result = await syncOnce({
    store: directoryStore(resolve(dir, "bucket")),
    account,
    home: homes[machine],
    machine: `m${machine}`,
  });
  quarantined.push(...result.quarantined.map((path) => `${machine}: ${path}`));
}

async function converge(): Promise<void> {
  await sync("A");
  await sync("B");
  await sync("A");
}

const reviewItem = (id: string): ReviewItem => ({
  ts: "2026-11-27T10:00:00.000Z",
  source: "test",
  id,
  reason: "unknown-existing",
  entity: {
    kind: "person",
    name: id,
    existing: "",
    aliases: [],
    role: "",
    organization: "",
    relation: "",
    fact: "",
  },
  candidates: [],
});

function useOnce(machine: Machine, n: number): void {
  const at = new Date(Date.UTC(2026, 10, 27, 10, n));
  appendTurn(
    {
      session: `${machine}${n}`,
      message: "no, the other one",
      replyEnd: "Renamed the key.",
      reaction: "corrected",
      issue: "wrong key",
    },
    at
  );
  recordCandidate(
    {
      when: `Case ${machine}${n}`,
      trigger: { side: "reply", pattern: "tests? pass" },
      steering: "Quote the test run.",
      check: "The reply quotes a test run.",
      evidence: [],
    },
    []
  );
  const draft = addDraft({ when: `Draft ${machine}${n}`, steering: "s", evidence: [] });
  decideRule(draft.id, "denied");
  writeContextDigests();
  queueForReview([reviewItem(`${machine}${n}`)]);
  appendImportLog(homes[machine], {
    ts: at.toISOString(),
    archive: `${machine}${n}.zip`,
    mode: "merge",
    created: 0,
    merged: 0,
    identical: 0,
    conflicts: 0,
    skipped: 0,
    linesAdded: 0,
    quarantineDir: null,
  });
  appendProjectHistory(resolve(dir, "checkouts", "loose"), {
    date: "2026-11-27",
    title: `${machine}${n}`,
    summary: "s",
    insights: "i",
  });
}

function bindLooseProject(): void {
  const record = resolve(storeDir("project-history"), "loose");
  mkdirSync(record, { recursive: true });
  writeFileSync(
    resolve(record, "ISA.md"),
    '---\nname: "loose"\nstatus: "active"\ncreated: "2026-01-01"\n---\n\n## Goal\nShip.\n'
  );
  writeBinding("loose", resolve(dir, "checkouts", "loose"));
}

describe("two machines in normal use", () => {
  test("merge every store they both write without quarantining a file", async () => {
    on("A", () => useOnce("A", 1));
    await converge();

    for (let round = 2; round <= 3; round++) {
      on("A", () => useOnce("A", round));
      on("B", () => useOnce("B", round));
      on("B", () => rejectReview(`A${round - 1}`));

      if (round === 3) on("A", bindLooseProject);
      await converge();
    }

    expect(quarantined).toEqual([]);
  });

  test("end up reading the same rules, candidates, turns and review queue", async () => {
    for (let round = 1; round <= 2; round++) {
      on("A", () => useOnce("A", round));
      on("B", () => useOnce("B", round));
      await converge();
    }

    on("B", () => rejectReview("A1"));
    await converge();

    const view = () => ({
      rules: readRules()
        .map((r) => [r.id, r.status])
        .sort(),
      candidates: readCandidates()
        .map((c) => c.id)
        .sort(),
      turns: readTurns(30, new Date("2026-11-28T00:00:00Z"))
        .map((t) => t.session)
        .sort(),
      pending: pendingReviews()
        .map((i) => i.id)
        .sort(),
    });
    const a = on("A", view);

    expect(on("B", view)).toEqual(a);
    expect(a.rules).toHaveLength(4);
    expect(a.pending).toEqual(["A2", "B1", "B2"]);
  });
});
