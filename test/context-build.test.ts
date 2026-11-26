import { describe, expect, test } from "bun:test";
import { buildSystemReminder } from "../src/context/context";
import { reload } from "../src/core/settings";
import { addOpinion } from "../src/opinions/adaptation-rules";
import { appendProjectHistory } from "../src/progress/work-tracking";
import { freshPalHomeEachTest } from "./lib/context-build-fixture";

const { write } = freshPalHomeEachTest(import.meta.file);

describe("buildSystemReminder", () => {
  test("opens with the doctor's notice and asks the model to pass it on", () => {
    write(
      "cache/health.json",
      JSON.stringify({ failing: 0, warnings: 3, notice: "2 data moves wait for you" })
    );

    const reminder = buildSystemReminder({ agent: "claude" });

    expect(reminder).toContain(
      "## PAL notice\n2 data moves wait for you. Tell the user once"
    );
  });

  test("carries no notice section when the doctor left none", () => {
    write("cache/health.json", JSON.stringify({ failing: 0, warnings: 3, notice: null }));

    expect(buildSystemReminder({ agent: "claude" })).not.toContain("PAL notice");
  });

  function optInToDueReminders() {
    write(
      "memory/pal-settings.json",
      JSON.stringify({ dynamicContext: { dueReminders: true } })
    );
    reload();
  }

  test("leaves due reminders out until the user opts in", () => {
    expect(buildSystemReminder({ agent: "cursor" })).not.toContain(
      "## Learning Analysis Due"
    );
  });

  test("surfaces the analyze nudge at startup for an agent with no per-turn context", () => {
    optInToDueReminders();
    const out = buildSystemReminder({ agent: "cursor" });

    expect(out).toContain("## Learning Analysis Due");
    expect(out).toContain("/pal-analyze");
  });

  test("keeps the analyze nudge in every session until a reply passes it on", () => {
    optInToDueReminders();
    expect(buildSystemReminder({ agent: "cursor" })).toContain(
      "## Learning Analysis Due"
    );
    expect(buildSystemReminder({ agent: "cursor" })).toContain(
      "## Learning Analysis Due"
    );
  });

  test("leaves due nudges to the per-turn context where the agent hears it", () => {
    optInToDueReminders();
    expect(buildSystemReminder({ agent: "claude" })).not.toContain(
      "## Learning Analysis Due"
    );
  });

  test("wraps content in a system-reminder with the current time", () => {
    const out = buildSystemReminder();

    expect(out.startsWith("<system-reminder>")).toBe(true);
    expect(out.trimEnd().endsWith("</system-reminder>")).toBe(true);
    expect(out).toContain("**Current time:**");
  });

  test("includes approved opinions for Codex and leaves them to native loading elsewhere", () => {
    addOpinion({
      when: "Designing a system",
      steering: "Treat the setup as a choice.",
      kind: "status-quo-bias",
      evidence: [],
    });

    expect(buildSystemReminder({ agent: "codex" })).toContain(
      "- Designing a system: Treat the setup as a choice."
    );
    expect(buildSystemReminder({ agent: "claude" })).not.toContain("Designing a system");
    write(
      "memory/pal-settings.json",
      JSON.stringify({ dynamicContext: { opinions: false } })
    );
    reload();
    expect(buildSystemReminder({ agent: "codex" })).not.toContain("Designing a system");
  });

  test("leaves past sessions to the active projects list", () => {
    appendProjectHistory(process.cwd(), {
      date: "2026-09-30",
      title: "An earlier session here",
      summary: "What that session did.",
      insights: "",
    });

    expect(buildSystemReminder()).not.toContain("An earlier session here");
  });
});

describe("a handoff left by an earlier PAL", () => {
  test("no longer reaches the session, here or from another folder", () => {
    write(
      "memory/state/last-handoff.json",
      JSON.stringify({
        [process.cwd()]: {
          handoff: "the remaining work",
          title: "a previous session",
          status: "in-progress",
          timestamp: new Date().toISOString(),
        },
        "/elsewhere": {
          handoff: "someone else work",
          title: "t",
          status: "in-progress",
          timestamp: new Date().toISOString(),
        },
      })
    );

    const out = buildSystemReminder();
    expect(out).not.toContain("the remaining work");
    expect(out).not.toContain("someone else work");
  });
});
