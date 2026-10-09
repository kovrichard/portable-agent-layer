import { beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  acknowledgeMentioned,
  dueNudgeReminder,
  pendingToday,
} from "../src/hooks/lib/daily-nudge";
import { reload } from "../src/hooks/lib/settings";
import { freshTestDir } from "./lib/test-home";

let HOME: string;

function setTimezone(timezone: string): void {
  writeFileSync(
    resolve(HOME, "memory", "pal-settings.json"),
    JSON.stringify({ identity: { principal: { timezone } } })
  );
  reload();
}

beforeEach(() => {
  HOME = freshTestDir(import.meta.file);
  mkdirSync(resolve(HOME, "memory", "state"), { recursive: true });
  process.env.PAL_HOME = HOME;
  reload();
});

describe("a due reminder", () => {
  const morning = new Date("2026-09-30T08:00:00Z");
  const evening = new Date("2026-09-30T18:00:00Z");
  const nextMorning = new Date("2026-10-01T08:00:00Z");

  test("is not used up by being built into a session", () => {
    pendingToday("analyze", "## Due", morning);
    expect(pendingToday("analyze", "## Due", evening)).toBe("## Due");
  });

  test("a reply naming its command clears it for the rest of the day", () => {
    acknowledgeMentioned(
      "Learning analysis is due. Want me to run /pal-analyze?",
      morning
    );
    expect(pendingToday("analyze", "## Due", evening)).toBe("");
  });

  test("a reply that does not name it leaves it pending", () => {
    acknowledgeMentioned("Merged and verified on main.", morning);
    expect(pendingToday("analyze", "## Due", evening)).toBe("## Due");
  });

  test("comes back the next day", () => {
    acknowledgeMentioned("Run /pal-analyze?", morning);
    expect(pendingToday("analyze", "## Due", nextMorning)).toBe("## Due");
  });

  test("is acknowledged separately for each reminder", () => {
    acknowledgeMentioned("Run /pal-analyze?", morning);
    expect(pendingToday("reflect", "## Reflect due", evening)).toBe("## Reflect due");
  });

  test("nothing to remind stays empty", () => {
    expect(pendingToday("analyze", "", morning)).toBe("");
  });

  test("the day turns over at the user's midnight, not UTC's", () => {
    setTimezone("Europe/Budapest");
    acknowledgeMentioned("Run /pal-analyze?", new Date("2026-09-30T20:00:00Z"));
    expect(pendingToday("analyze", "## Due", new Date("2026-09-30T22:30:00Z"))).toBe(
      "## Due"
    );
  });

  test("an unreadable record shows the reminder rather than hiding it", () => {
    writeFileSync(resolve(HOME, "memory", "state", "nudges-shown.json"), "{ not json");
    expect(pendingToday("analyze", "## Due", morning)).toBe("## Due");
  });
});

describe("the per-turn reminder", () => {
  const morning = new Date("2026-09-30T08:00:00Z");

  function optInToDueReminders(): void {
    writeFileSync(
      resolve(HOME, "memory", "pal-settings.json"),
      JSON.stringify({ dynamicContext: { dueReminders: true } })
    );
    reload();
  }

  test("is off until the user opts in", () => {
    expect(dueNudgeReminder(morning)).toBeNull();
  });

  test("asks the agent to tell the user what is due", () => {
    optInToDueReminders();
    const reminder = dueNudgeReminder(morning) ?? "";
    expect(reminder).toContain("Tell the user");
    expect(reminder).toContain("/pal-analyze");
  });

  test("goes quiet once a reply has passed it on", () => {
    optInToDueReminders();
    acknowledgeMentioned("Learning analysis is due: /pal-analyze", morning);
    expect(dueNudgeReminder(morning)).toBeNull();
  });
});
