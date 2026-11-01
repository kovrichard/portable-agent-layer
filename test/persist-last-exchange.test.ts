import { beforeEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { persistLastExchange } from "../src/hooks/handlers/persist-last-exchange";
import { removeOnceReleased } from "./lib/remove-once-released";
import { testHome } from "./lib/test-home";

const HOME = testHome(import.meta.file);
const STATE = resolve(HOME, "memory", "state");

const messages = [
  { role: "user", content: "the user's last message" },
  { role: "assistant", content: "the assistant's last reply" },
];

beforeEach(() => {
  removeOnceReleased(HOME);
  process.env.PAL_HOME = HOME;
});

describe("persistLastExchange", () => {
  test("keeps the exchange for recall after a compaction", () => {
    persistLastExchange(messages, "sess-1");
    for (const name of ["sess-1.json", "latest.json"]) {
      const saved = JSON.parse(
        readFileSync(resolve(STATE, "last-exchange", name), "utf-8")
      );
      expect(saved).toMatchObject({
        sessionId: "sess-1",
        userMessage: "the user's last message",
        assistantMessage: "the assistant's last reply",
      });
    }
  });

  test("leaves no handoff behind", () => {
    persistLastExchange(messages, "sess-1");
    expect(existsSync(resolve(STATE, "last-handoff.json"))).toBe(false);
  });
});
