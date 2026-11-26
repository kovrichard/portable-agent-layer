import { beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  ctx,
  DEFAULT_CONFIG,
  eventsNamed,
  ghCalls,
  git,
  NOOP,
  resultOf,
  runBuild,
  setScenario,
  setup,
  specText,
  storedTask,
  TASK,
  useFreshContext,
} from "./lib/dark-factory-build-harness";

setDefaultTimeout(90_000);

beforeEach(() => {
  useFreshContext(import.meta.file);
});

describe("syncing before the pull request", () => {
  test("a real conflict with the base is reported as one", () => {
    const other = join(ctx.root, "other");
    setup("small");
    const clash = `git clone -q "${ctx.remote}" "${other}" && cd "${other}" && echo theirs > feature.txt && git add -A && git commit -q -m other && git push -q origin canary`;
    setScenario({ roles: { "code-writer": [{ shell: clash }] } });
    const run = runBuild();
    expect(run.exitCode).toBe(1);
    expect(resultOf(run).message).toContain("conflicts with canary");
    expect(ghCalls()).toEqual([]);
  });

  test("a failed command is reported as that, never as a conflict", () => {
    setup("small");
    setScenario({
      roles: { "code-writer": [{ shell: `mv "${ctx.remote}" "${ctx.remote}.gone"` }] },
    });
    const run = runBuild();
    expect(run.exitCode).toBe(1);
    const message = resultOf(run).message as string;
    expect(message).toContain("sync failed");
    expect(message).not.toContain("conflicts with");
  });
});

describe("the config frozen by prepare", () => {
  const EXTRA_CHECK = { name: "extra", run: "test -f extra.txt" };
  const TWO_CHECKS = { ...DEFAULT_CONFIG, gate: [...DEFAULT_CONFIG.gate, EXTRA_CHECK] };
  const gateCheckNames = () => eventsNamed("gate_check").map((event) => event.check);

  test("prepare stores the checkout's config in task.json", () => {
    setup("small", {}, TWO_CHECKS);
    runBuild();
    expect(storedTask().config).toEqual(TWO_CHECKS);
  });

  test("a rerun stores the config as it is in the checkout now", () => {
    const question = { done: false, summary: "", question: "which file?" };
    setup("small", {
      roles: {
        "code-writer": [{ ...NOOP, reply: question }],
        po: [{ reply: { userQuestion: "Which database?" } }],
      },
    });
    expect(runBuild().exitCode).toBe(3);
    expect(storedTask().config).toEqual(DEFAULT_CONFIG);
    writeFileSync(join(ctx.repo, ".dark-factory.json"), JSON.stringify(TWO_CHECKS));
    writeFileSync(
      join(ctx.factory, "tasks", TASK, "spec.md"),
      `${specText()}- Rico: use postgres\n`
    );
    setScenario({
      roles: { "code-writer": [{ write: { "extra.txt": "x" }, commit: true }] },
    });
    runBuild();
    expect(storedTask().config).toEqual(TWO_CHECKS);
  });

  test("a task started before this change, with no config, gets one on the next prepare", () => {
    setup("small");
    expect(storedTask().config).toBeUndefined();
    const run = runBuild();
    expect(resultOf(run).status).toBe("ready");
    expect(storedTask().config).toEqual(DEFAULT_CONFIG);
  });

  test("a config that is not on the base branch still drives the gate", () => {
    setup("feature");
    git(ctx.repo, "rm", "-q", "--cached", ".dark-factory.json");
    git(ctx.repo, "commit", "-q", "-m", "untrack config");
    git(ctx.repo, "push", "-q", "origin", "canary");
    const run = runBuild();
    expect(resultOf(run).status).toBe("ready");
    expect(eventsNamed("tests_red")).toHaveLength(1);
    expect(gateCheckNames()).toContain("tests");
    expect(eventsNamed("gate").at(-1)?.result).toBe("pass");
  });
});
