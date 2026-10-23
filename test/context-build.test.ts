import { describe, expect, test } from "bun:test";
import { addOpinion } from "../src/hooks/lib/adaptation-rules";
import { buildSystemReminder } from "../src/hooks/lib/context";
import { reload } from "../src/hooks/lib/settings";
import { appendProjectHistory } from "../src/hooks/lib/work-tracking";
import { freshPalHomeEachTest } from "./lib/context-build-fixture";

const { write } = freshPalHomeEachTest(import.meta.file);

describe("buildSystemReminder", () => {
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

  test("drops only the handoff when asked to go without it", () => {
    write(
      "memory/state/last-handoff.json",
      JSON.stringify({
        [process.cwd()]: {
          title: "open work",
          handoff: "finish the gate",
          status: "in-progress",
          timestamp: new Date().toISOString(),
        },
      })
    );

    expect(buildSystemReminder()).toContain("finish the gate");
    const out = buildSystemReminder({ withoutHandoff: true });
    expect(out).not.toContain("finish the gate");
    expect(out).toContain("**Current time:**");
  });

  test("leaves past sessions to the handoff and the active projects list", () => {
    appendProjectHistory(process.cwd(), {
      date: "2026-09-30",
      title: "An earlier session here",
      summary: "What that session did.",
      insights: "",
    });

    expect(buildSystemReminder()).not.toContain("An earlier session here");
  });
});

function handoff(over: Record<string, unknown> = {}) {
  write(
    "memory/state/last-handoff.json",
    JSON.stringify({
      [process.cwd()]: {
        handoff: "the remaining work",
        title: "a previous session",
        status: "in-progress",
        timestamp: new Date().toISOString(),
        ...over,
      },
    })
  );
}

describe("handoff", () => {
  test("is absent when no handoff was recorded", () => {
    expect(buildSystemReminder()).not.toContain("Pick Up Where You Left Off");
  });

  test("surfaces an in-progress handoff for this project", () => {
    handoff();

    const out = buildSystemReminder();

    expect(out).toContain("## Pick Up Where You Left Off");
    expect(out).toContain("*Previous session: a previous session · 0m ago*");
    expect(out).toContain("the remaining work");
    expect(out).toContain("→ Continue this work");
  });

  test("a finished session stays available for follow-ups, not as open work", () => {
    handoff({ status: "completed", lastUser: "what about the gate?" });

    const out = buildSystemReminder();
    expect(out).toContain("- User: what about the gate?");
    expect(out).not.toContain("→ Continue this work");
  });

  test("drops a handoff older than a week", () => {
    handoff({ timestamp: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString() });

    expect(buildSystemReminder()).not.toContain("Pick Up Where You Left Off");
  });

  test("keeps a handoff from within the week", () => {
    handoff({ timestamp: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString() });

    expect(buildSystemReminder()).toContain("Pick Up Where You Left Off");
  });

  test("shows another folder's handoff only as the conversation elsewhere", () => {
    write(
      "memory/state/last-handoff.json",
      JSON.stringify({
        "/elsewhere": {
          handoff: "someone else work",
          title: "t",
          status: "in-progress",
          timestamp: new Date().toISOString(),
        },
      })
    );

    const out = buildSystemReminder();
    expect(out).not.toContain("Pick Up Where You Left Off");
    expect(out).toContain("## Last Conversation Elsewhere");
    expect(out).toContain("someone else work");
  });
});
