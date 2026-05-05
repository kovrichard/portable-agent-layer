import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const TEST_HOME = resolve(import.meta.dir, "../.test-home-auto-graduate");

beforeAll(() => {
  process.env.PAL_HOME = TEST_HOME;
  if (existsSync(TEST_HOME)) rmSync(TEST_HOME, { recursive: true });
  mkdirSync(TEST_HOME, { recursive: true });
});

afterAll(() => {
  delete process.env.PAL_HOME;
  if (existsSync(TEST_HOME)) rmSync(TEST_HOME, { recursive: true });
});

beforeEach(() => {
  for (const dir of [
    resolve(TEST_HOME, "memory", "learning"),
    resolve(TEST_HOME, "memory", "wisdom"),
  ]) {
    if (existsSync(dir)) rmSync(dir, { recursive: true });
  }
});

function seedClarifyIntentCorpus(): void {
  // Six captures with overlapping vocabulary so graduation's Dice clusters
  // them as a single recurring pattern. 6 occurrences → confidence 90% (≥85
  // CRYSTAL floor).
  const contexts = [
    "User had to clarify intent because I delivered wrong feature without asking",
    "I delivered without clarifying intent and built the wrong feature",
    "Skipped clarifying intent before delivering and built wrong scope",
    "User said I should clarify intent before delivering wrong implementation",
    "Wrong feature delivered because I did not clarify intent or scope",
    "Built wrong scope without clarifying intent before delivering work",
  ];
  contexts.forEach((ctx, i) => {
    const dir = resolve(
      TEST_HOME,
      "memory",
      "learning",
      "failures",
      "2026",
      "04",
      `2026041${i}-100000_clarify-intent-${i}`
    );
    mkdirSync(dir, { recursive: true });
    const fm = [
      "---",
      "rating: 3",
      `context: "${ctx}"`,
      `principle: "Always clarify intent before delivering work"`,
      `ts: 2026-04-1${i}T10:00:00Z`,
      `slug: clarify-intent-${i}`,
      "---",
      "",
    ].join("\n");
    writeFileSync(resolve(dir, "capture.md"), fm);
  });
}

async function freshHandler() {
  const t = Date.now();
  const mod = await import(`../src/hooks/handlers/auto-graduate.ts?t=${t}`);
  return mod.autoGraduate as (opts?: { force?: boolean }) => Promise<{
    ranAnalysis: boolean;
    candidatesAtFloor: number;
    promoted: number;
    skippedByState: number;
    skippedByContent: number;
  }>;
}

async function freshWisdom() {
  const t = Date.now();
  const mod = await import(`../src/hooks/lib/wisdom.ts?t=${t}`);
  return {
    promoteCrystal: mod.promoteCrystal as (
      domain: string,
      principle: string,
      confidence: number
    ) => { skipped: "duplicate" | null; framePath: string },
  };
}

function statePath(): string {
  return resolve(TEST_HOME, "memory", "wisdom", "state", "graduated.json");
}

function readState(): {
  lastRun: string;
  graduated: { pattern: string; domain: string; confidence: number }[];
} {
  return JSON.parse(readFileSync(statePath(), "utf-8"));
}

describe("autoGraduate — happy path", () => {
  test("empty corpus → no promotions, no errors", async () => {
    const fn = await freshHandler();
    const res = await fn({ force: true });
    expect(res.promoted).toBe(0);
    expect(res.candidatesAtFloor).toBe(0);
    expect(res.skippedByState).toBe(0);
  });

  test("six similar captures → exactly one CRYSTAL line written, exactly one state entry", async () => {
    seedClarifyIntentCorpus();
    const fn = await freshHandler();
    const res = await fn({ force: true });

    expect(res.candidatesAtFloor).toBeGreaterThanOrEqual(1);
    expect(res.promoted).toBe(1);

    const state = readState();
    expect(state.graduated.length).toBe(1);
    expect(state.graduated[0].confidence).toBeGreaterThanOrEqual(85);

    // Find the written frame and assert exactly one CRYSTAL line
    const framesDir = resolve(TEST_HOME, "memory", "wisdom", "frames");
    const frameFiles = require("node:fs").readdirSync(framesDir);
    expect(frameFiles.length).toBeGreaterThanOrEqual(1);
    const allFramesContent = frameFiles
      .map((f: string) => readFileSync(resolve(framesDir, f), "utf-8"))
      .join("\n");
    const crystalCount = (allFramesContent.match(/\[CRYSTAL:\s*\d+%\]/g) ?? []).length;
    expect(crystalCount).toBe(1);
  });
});

describe("autoGraduate — idempotency (the load-bearing contract)", () => {
  test("50× rapid calls without force → exactly one promotion (TTL guard)", async () => {
    seedClarifyIntentCorpus();
    const fn = await freshHandler();

    let totalPromoted = 0;
    for (let i = 0; i < 50; i++) {
      const res = await fn();
      totalPromoted += res.promoted;
    }

    expect(totalPromoted).toBe(1);
    const state = readState();
    expect(state.graduated.length).toBe(1);

    const framesDir = resolve(TEST_HOME, "memory", "wisdom", "frames");
    const frameFiles = require("node:fs").readdirSync(framesDir);
    const allFramesContent = frameFiles
      .map((f: string) => readFileSync(resolve(framesDir, f), "utf-8"))
      .join("\n");
    const crystalCount = (allFramesContent.match(/\[CRYSTAL:\s*\d+%\]/g) ?? []).length;
    expect(crystalCount).toBe(1);
  });

  test("50× rapid calls WITH force → STILL exactly one promotion (state + content dedup)", async () => {
    seedClarifyIntentCorpus();
    const fn = await freshHandler();

    let totalPromoted = 0;
    for (let i = 0; i < 50; i++) {
      const res = await fn({ force: true });
      totalPromoted += res.promoted;
    }

    // First iteration promotes once; remaining 49 hit state-dedup.
    expect(totalPromoted).toBe(1);
    const state = readState();
    expect(state.graduated.length).toBe(1);

    const framesDir = resolve(TEST_HOME, "memory", "wisdom", "frames");
    const frameFiles = require("node:fs").readdirSync(framesDir);
    const allFramesContent = frameFiles
      .map((f: string) => readFileSync(resolve(framesDir, f), "utf-8"))
      .join("\n");
    const crystalCount = (allFramesContent.match(/\[CRYSTAL:\s*\d+%\]/g) ?? []).length;
    expect(crystalCount).toBe(1);
  });

  test("force after state-corrupt (graduated[]=empty) → content-dedup catches duplicate", async () => {
    seedClarifyIntentCorpus();
    const fn = await freshHandler();

    // First run: writes CRYSTAL + state.
    const first = await fn({ force: true });
    expect(first.promoted).toBe(1);

    // Simulate state corruption — wipe graduated[] but keep frame
    const state = readState();
    state.graduated = [];
    writeFileSync(statePath(), JSON.stringify(state, null, 2), "utf-8");

    // Second run: state-dedup misses, content-dedup must catch it
    const second = await fn({ force: true });
    expect(second.promoted).toBe(0);
    expect(second.skippedByContent).toBe(1);

    // Frame still has exactly one CRYSTAL line
    const framesDir = resolve(TEST_HOME, "memory", "wisdom", "frames");
    const frameFiles = require("node:fs").readdirSync(framesDir);
    const allFramesContent = frameFiles
      .map((f: string) => readFileSync(resolve(framesDir, f), "utf-8"))
      .join("\n");
    const crystalCount = (allFramesContent.match(/\[CRYSTAL:\s*\d+%\]/g) ?? []).length;
    expect(crystalCount).toBe(1);
  });
});

describe("promoteCrystal — content-dedup unit", () => {
  test("scaffolds a new frame when domain doesn't exist", async () => {
    const { promoteCrystal } = await freshWisdom();
    const out = promoteCrystal("brand-new", "Run gates before commit", 90);
    expect(out.skipped).toBeNull();
    expect(existsSync(out.framePath)).toBe(true);
    const content = readFileSync(out.framePath, "utf-8");
    expect(content).toContain("[CRYSTAL: 90%]");
    expect(content).toContain("Run gates before commit");
  });

  test("Dice-similar CRYSTAL line already in frame → skipped: duplicate, no write", async () => {
    const { promoteCrystal } = await freshWisdom();
    promoteCrystal("workflow", "Always run gates before commit", 90);
    const before = readFileSync(
      resolve(TEST_HOME, "memory", "wisdom", "frames", "workflow.md"),
      "utf-8"
    );
    const out = promoteCrystal("workflow", "Always run all gates before committing", 92);
    expect(out.skipped).toBe("duplicate");
    const after = readFileSync(
      resolve(TEST_HOME, "memory", "wisdom", "frames", "workflow.md"),
      "utf-8"
    );
    expect(after).toBe(before);
  });

  test("dissimilar principle → second CRYSTAL line appended", async () => {
    const { promoteCrystal } = await freshWisdom();
    promoteCrystal("workflow", "Always run gates before commit", 90);
    const out = promoteCrystal(
      "workflow",
      "Pin consumer offsets explicitly during failover",
      92
    );
    expect(out.skipped).toBeNull();
    const content = readFileSync(
      resolve(TEST_HOME, "memory", "wisdom", "frames", "workflow.md"),
      "utf-8"
    );
    expect((content.match(/\[CRYSTAL:\s*\d+%\]/g) ?? []).length).toBe(2);
  });
});
