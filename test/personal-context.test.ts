import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

// These two commands are the onboarding skill's only way in: settings are
// hook-protected, and the skill must not decide "unanswered" for itself.

let HOME: string;

beforeEach(async () => {
  HOME = mkdtempSync(resolve(tmpdir(), "pal-personal-context-"));
  process.env.PAL_HOME = HOME;
  mkdirSync(resolve(HOME, "memory"), { recursive: true });
  mkdirSync(resolve(HOME, "telos"), { recursive: true });
  (await import("../src/hooks/lib/settings")).reload();
});

afterEach(async () => {
  delete process.env.PAL_HOME;
  rmSync(HOME, { recursive: true, force: true });
  (await import("../src/hooks/lib/settings")).reload();
});

function answer(file: string) {
  writeFileSync(resolve(HOME, "telos", file), `# T\n\nsomething the user said\n`);
}

function storedTimezone(): string | undefined {
  const path = resolve(HOME, "memory", "pal-settings.json");
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, "utf-8")).identity?.principal?.timezone;
}

async function capture(work: () => number): Promise<{ code: number; out: string }> {
  const original = console.log;
  let out = "";
  console.log = (...args: unknown[]) => {
    out += `${args.join(" ")}\n`;
  };
  try {
    return { code: work(), out };
  } finally {
    console.log = original;
  }
}

async function cli() {
  return await import(`../src/cli/personal-context.ts?t=${Date.now()}`);
}

describe("pal cli telos", () => {
  test("names the first unanswered priority topic on a fresh install", async () => {
    const { runTelos } = await cli();
    const { code, out } = await capture(() => runTelos([]));

    expect(code).toBe(0);
    expect(out).toContain("next: mission");
  });

  test("moves to the next topic as answers land", async () => {
    answer("MISSION.md");
    answer("GOALS.md");
    const { runTelos } = await cli();
    const { out } = await capture(() => runTelos([]));

    expect(out).toContain("next: challenges");
  });

  test("reports every topic with its state, optional ones marked", async () => {
    answer("MISSION.md");
    const { runTelos } = await cli();
    const { out } = await capture(() => runTelos([]));

    expect(out).toMatch(/answered\s+mission/);
    expect(out).toMatch(/unanswered\s+goals/);
    expect(out).toMatch(/ideas.*\(optional\)/);
  });

  test("says there is nothing left once the five priority topics are answered", async () => {
    for (const f of [
      "MISSION.md",
      "GOALS.md",
      "CHALLENGES.md",
      "STRATEGIES.md",
      "BELIEFS.md",
    ]) {
      answer(f);
    }
    const { runTelos } = await cli();
    const { out } = await capture(() => runTelos([]));

    expect(out).toContain("next: none");
  });

  test("refuses an argument rather than silently ignoring it", async () => {
    const { runTelos } = await cli();
    const { code } = await capture(() => runTelos(["mission"]));

    expect(code).toBe(1);
  });
});

describe("pal cli timezone", () => {
  test("reports an unset timezone as unset, not as UTC", async () => {
    const { runTimezone } = await cli();
    const { code, out } = await capture(() => runTimezone([]));

    expect(code).toBe(0);
    expect(out).toContain("not set");
  });

  test("stores a valid IANA zone", async () => {
    const { runTimezone } = await cli();
    const { code } = await capture(() => runTimezone(["Europe/Budapest"]));

    expect(code).toBe(0);
    expect(storedTimezone()).toBe("Europe/Budapest");
  });

  test("shows what was stored", async () => {
    const { runTimezone } = await cli();
    await capture(() => runTimezone(["Asia/Tokyo"]));
    const { out } = await capture(() => runTimezone([]));

    expect(out).toContain("timezone: Asia/Tokyo");
  });

  test("refuses a zone Intl does not recognise, and writes nothing", async () => {
    const { runTimezone } = await cli();
    const { code } = await capture(() => runTimezone(["Mars/Olympus_Mons"]));

    expect(code).toBe(1);
    expect(storedTimezone()).toBeUndefined();
  });

  test("stores the canonical spelling rather than what was typed", async () => {
    const { runTimezone } = await cli();
    await capture(() => runTimezone(["europe/budapest"]));

    expect(storedTimezone()).toBe("Europe/Budapest");
  });

  test("keeps the rest of settings intact", async () => {
    writeFileSync(
      resolve(HOME, "memory", "pal-settings.json"),
      JSON.stringify({
        identity: { ai: { name: "Jarvis" } },
        dynamicContext: { x: false },
      })
    );
    (await import("../src/hooks/lib/settings")).reload();
    const { runTimezone } = await cli();
    await capture(() => runTimezone(["Asia/Tokyo"]));

    const data = JSON.parse(
      readFileSync(resolve(HOME, "memory", "pal-settings.json"), "utf-8")
    );
    expect(data.identity.ai.name).toBe("Jarvis");
    expect(data.dynamicContext.x).toBe(false);
    expect(data.identity.principal.timezone).toBe("Asia/Tokyo");
  });
});
