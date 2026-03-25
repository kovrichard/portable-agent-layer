import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const TEST_HOME = resolve(import.meta.dir, "../.test-home-opinions");

beforeAll(() => {
  if (existsSync(TEST_HOME)) rmSync(TEST_HOME, { recursive: true });
  mkdirSync(resolve(TEST_HOME, "memory", "relationship"), { recursive: true });
  process.env.PAL_HOME = TEST_HOME;
});

afterAll(() => {
  delete process.env.PAL_HOME;
  if (existsSync(TEST_HOME)) rmSync(TEST_HOME, { recursive: true });
});

describe("opinions", () => {
  test("createOpinion starts at 0.60 confidence", async () => {
    const { createOpinion } = await import("../src/hooks/lib/opinions");
    const op = createOpinion("User prefers concise responses", "test");
    expect(op.confidence).toBe(0.6);
    expect(op.evidence).toHaveLength(1);
    expect(op.evidence[0].type).toBe("supporting");
  });

  test("addEvidence increases confidence for supporting", async () => {
    const { createOpinion, addEvidence } = await import("../src/hooks/lib/opinions");
    const op = createOpinion("User prefers concise responses", "test");
    const updated = addEvidence(op, "supporting", "another instance");
    expect(updated.confidence).toBe(0.65);
    expect(updated.evidence).toHaveLength(2);
  });

  test("addEvidence decreases confidence for counter", async () => {
    const { createOpinion, addEvidence } = await import("../src/hooks/lib/opinions");
    const op = createOpinion("User prefers verbose output", "test");
    const updated = addEvidence(op, "counter", "contradicted");
    expect(updated.confidence).toBe(0.5);
  });

  test("addEvidence jumps for confirmation", async () => {
    const { createOpinion, addEvidence } = await import("../src/hooks/lib/opinions");
    const op = createOpinion("User values direct feedback", "test");
    const updated = addEvidence(op, "confirmation", "user said yes");
    expect(updated.confidence).toBe(0.7);
  });

  test("addEvidence drops for contradiction", async () => {
    const { createOpinion, addEvidence } = await import("../src/hooks/lib/opinions");
    const op = createOpinion("User avoids long sessions", "test");
    const updated = addEvidence(op, "contradiction", "user disagreed");
    expect(updated.confidence).toBe(0.4);
  });

  test("confidence clamps to 0.01-0.99", async () => {
    const { addEvidence } = await import("../src/hooks/lib/opinions");
    const high = {
      id: "x",
      statement: "x",
      confidence: 0.98,
      category: "general" as const,
      evidence: [],
      created: "",
      updated: "",
    };
    expect(addEvidence(high, "supporting", "").confidence).toBe(0.99);

    const low = {
      id: "y",
      statement: "y",
      confidence: 0.02,
      category: "general" as const,
      evidence: [],
      created: "",
      updated: "",
    };
    expect(addEvidence(low, "contradiction", "").confidence).toBe(0.01);
  });

  test("saveOpinion and readOpinions round-trip", async () => {
    const { createOpinion, saveOpinion, readOpinions } = await import(
      "../src/hooks/lib/opinions"
    );
    const op = createOpinion("User likes iterative work", "test");
    saveOpinion(op);

    const all = readOpinions();
    expect(all.length).toBeGreaterThanOrEqual(1);
    expect(all.find((o) => o.statement === "User likes iterative work")).toBeTruthy();
  });

  test("saveOpinion upserts by id", async () => {
    const { createOpinion, addEvidence, saveOpinion, readOpinions } = await import(
      "../src/hooks/lib/opinions"
    );
    const op = createOpinion("User likes iterative work", "test");
    saveOpinion(op);
    const updated = addEvidence(op, "supporting", "again");
    saveOpinion(updated);

    const all = readOpinions();
    const matches = all.filter((o) => o.statement === "User likes iterative work");
    expect(matches).toHaveLength(1);
    expect(matches[0].confidence).toBe(0.65);
  });

  test("findSimilarOpinion matches with Dice", async () => {
    const { createOpinion, findSimilarOpinion } = await import(
      "../src/hooks/lib/opinions"
    );
    const opinions = [createOpinion("User prefers concise direct responses", "test")];
    const match = findSimilarOpinion("User prefers concise responses", opinions);
    expect(match).toBeTruthy();
  });

  test("findSimilarOpinion returns null for unrelated text", async () => {
    const { createOpinion, findSimilarOpinion } = await import(
      "../src/hooks/lib/opinions"
    );
    const opinions = [createOpinion("User prefers concise direct responses", "test")];
    const match = findSimilarOpinion("deploy production server immediately", opinions);
    expect(match).toBeNull();
  });

  test("loadOpinionContext returns empty for low confidence", async () => {
    const { loadOpinionContext } = await import("../src/hooks/lib/opinions");
    const ctx = loadOpinionContext();
    // All test opinions are at 0.60-0.65, below 0.85 threshold
    expect(ctx).toBe("");
  });
});
