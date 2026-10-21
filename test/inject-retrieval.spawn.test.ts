import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { resolve } from "node:path";
import {
  captureStdout,
  injectRetrievalHome,
  loadHandlers,
  setSettings,
} from "./lib/inject-retrieval-fixture";
import { removeOnceReleased } from "./lib/remove-once-released";
import { SPAWN_HEAVY_TEST_MS } from "./lib/spawn-heavy";

setDefaultTimeout(SPAWN_HEAVY_TEST_MS);

const TEST_HOME = injectRetrievalHome(import.meta.file);

describe("injectPromptContext handler", () => {
  test("the repo state of the working directory rides along", async () => {
    await setSettings({ dynamicContext: { wallClock: false } });
    const { injectPromptContext } = await loadHandlers();
    const out = await captureStdout(() => injectPromptContext("anything goes here"));
    expect(out).toContain("Repo: ");
  });

  test("the active progress-tree node rides along once the scope has work", async () => {
    await setSettings({ dynamicContext: { progressTree: true } });
    const { appendEvent, scopeOf } = await import("../src/hooks/lib/progress-tree");
    const { sessionDir } = await import("../src/hooks/lib/session-dir");
    appendEvent(scopeOf(sessionDir()), "n1", "open", { title: "Gate", parent: null });
    const { injectPromptContext } = await loadHandlers();
    const out = await captureStdout(() => injectPromptContext("anything goes here"));
    expect(out).toContain("Progress: Gate [n1]");
    removeOnceReleased(resolve(TEST_HOME, "memory", "progress-tree"));
  });
});
