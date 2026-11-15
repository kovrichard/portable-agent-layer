import { beforeEach, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { readRatings } from "../src/bronze/signals";
import { captureRating } from "../src/hooks/handlers/rating";
import { runStopHandlers } from "../src/hooks/lib/stop";
import { sandboxContextRuleDirs } from "./lib/context-rule-dirs";
import { removeOnceReleased } from "./lib/remove-once-released";
import { SPAWN_HEAVY_TEST_MS } from "./lib/spawn-heavy";
import { testHome } from "./lib/test-home";

setDefaultTimeout(SPAWN_HEAVY_TEST_MS);

const HOME = testHome(import.meta.file);
const PREVIEW_LIMIT = 500;

beforeEach(() => {
  removeOnceReleased(HOME);
  mkdirSync(HOME, { recursive: true });
  process.env.PAL_HOME = HOME;
  sandboxContextRuleDirs(resolve(HOME, "agents"));
});

test("an explicit rating previews the session's last reply, cut to 500 characters", async () => {
  const reply = "r".repeat(PREVIEW_LIMIT + 100);
  await runStopHandlers(
    [
      { role: "user", content: "ask" },
      { role: "assistant", content: reply },
    ],
    { sessionId: "s-preview", lastAssistantMessage: reply }
  );

  captureRating("8", "s-preview");

  expect(readRatings()).toEqual([
    expect.objectContaining({
      rating: 8,
      source: "explicit",
      response_preview: reply.slice(0, PREVIEW_LIMIT),
    }),
  ]);
});
