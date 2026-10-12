import { beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { logAttention } from "../src/hooks/lib/attention-events";
import { observeTurn } from "../src/hooks/lib/interaction";
import { reload } from "../src/hooks/lib/settings";
import { logToolCall } from "../src/hooks/lib/tool-events";
import { permissionWaitSec } from "../src/hooks/lib/waiting-on-user";
import { freshTestDir } from "./lib/test-home";

let home: string;

function events(type: string): Record<string, unknown>[] {
  const file = resolve(
    home,
    "memory",
    "events",
    `${new Date().toISOString().slice(0, 7)}.jsonl`
  );
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf-8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l))
    .filter((e) => e.type === type);
}

function secondsAgo(sec: number): Date {
  return new Date(Date.now() - sec * 1000);
}

beforeEach(() => {
  home = freshTestDir(import.meta.file);
  process.env.PAL_HOME = home;
  process.env.PAL_AGENT = "claude";
  mkdirSync(resolve(home, "memory"), { recursive: true });
  reload();
});

describe("a permission prompt", () => {
  test("is logged with its tool, and the answered call says how long the user took", () => {
    logAttention(
      {
        hook_event_name: "PermissionRequest",
        session_id: "s1",
        tool_name: "Bash",
        tool_input: {},
      },
      secondsAgo(8)
    );
    logToolCall({ session_id: "s1", tool_name: "Bash", tool_input: { command: "ls" } });
    expect(events("permission_prompt")[0]).toMatchObject({ session: "s1", tool: "Bash" });
    const waited = events("tool_call")[0]?.promptWaitSec as number;
    expect(waited).toBeGreaterThanOrEqual(8);
    expect(waited).toBeLessThan(9);
  });

  test("the wait is counted once, and only for the tool that asked", () => {
    logAttention({
      hook_event_name: "PermissionRequest",
      session_id: "s1",
      tool_name: "Bash",
    });
    logToolCall({ session_id: "s1", tool_name: "Read", tool_input: {} });
    logToolCall({ session_id: "s1", tool_name: "Bash", tool_input: {} });
    logToolCall({ session_id: "s1", tool_name: "Bash", tool_input: {} });
    expect(events("tool_call").map((e) => e.promptWaitSec === null)).toEqual([
      true,
      false,
      true,
    ]);
  });

  test("a prompt left unanswered for over half an hour is not a wait", () => {
    logAttention(
      { hook_event_name: "PermissionRequest", session_id: "s1", tool_name: "Bash" },
      secondsAgo(31 * 60)
    );
    expect(permissionWaitSec("s1", "Bash")).toBeNull();
  });
});

describe("a notification", () => {
  test("is logged with its kind, and the next prompt says how long until the user was back", () => {
    logAttention(
      {
        hook_event_name: "Notification",
        session_id: "s1",
        notification_type: "idle_prompt",
        message: "Claude is waiting",
      },
      secondsAgo(42)
    );
    observeTurn("okay I am back, what is the state", "s1");
    observeTurn("and the next one is not a return", "s1");
    expect(events("notification")[0]).toMatchObject({ kind: "idle_prompt" });
    expect(JSON.stringify(events("notification"))).not.toContain("waiting");
    const [back, next] = events("turn").map((e) => e.backAfterSec as number | null);
    expect(back).toBeGreaterThanOrEqual(42);
    expect(next).toBeNull();
  });

  test("any other event on the shared hook is ignored", () => {
    logAttention({ hook_event_name: "Stop", session_id: "s1" });
    expect(events("notification")).toEqual([]);
    expect(events("permission_prompt")).toEqual([]);
  });
});

describe("the AttentionEvent hook", () => {
  test("prints nothing, so it never answers the prompt, and exits 0", async () => {
    const proc = Bun.spawn(
      ["bun", resolve(import.meta.dir, "../src/hooks/AttentionEvent.ts")],
      {
        stdin: new TextEncoder().encode(
          JSON.stringify({
            hook_event_name: "PermissionRequest",
            session_id: "s9",
            tool_name: "Bash",
          })
        ),
        env: { ...process.env, PAL_HOME: home },
        stdout: "pipe",
        stderr: "ignore",
      }
    );
    expect(await proc.exited).toBe(0);
    expect(await new Response(proc.stdout).text()).toBe("");
    expect(events("permission_prompt")[0]).toMatchObject({ session: "s9", tool: "Bash" });
  });
});
