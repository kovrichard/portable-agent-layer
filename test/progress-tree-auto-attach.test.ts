import { describe, expect, test } from "bun:test";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runPostToolHandlers } from "../src/hooks/lib/post-tool";
import { appendEvent, readEvents, readTree } from "../src/hooks/lib/progress-tree";
import {
  attach,
  attachments,
  factoryEvent,
  nodeHoldingTask,
  OTHER_TASK,
  openNode,
  PR,
  paths,
  SESSION,
  sessionStart,
  startEachTestInAFreshHome,
  TASK,
  tree,
} from "./lib/progress-tree-auto-attach-fixture";

startEachTestInAFreshHome(import.meta.file);

const runClaude = (command: string, stdout = "", extra: Record<string, unknown> = {}) =>
  runPostToolHandlers(
    {
      hook_event_name: "PostToolUse",
      session_id: SESSION,
      tool_name: "Bash",
      tool_input: { command },
      tool_response: { stdout, stderr: "", interrupted: false },
      ...extra,
    },
    ["--only=progress-tree"]
  );

describe("gh pr create attaches the PR", () => {
  test("a successful create attaches the printed URL to the active node", () => {
    openNode();
    runClaude("gh pr create --base canary --fill", `Creating pull request...\n${PR}\n`);
    expect(attachments()).toEqual([["n1", "pr", PR]]);
  });

  test("with no active node the session's node opens and takes the PR", () => {
    runClaude("gh pr create --fill", `${PR}\n`);
    const nodes = [...tree().nodes.values()];
    expect(nodes).toHaveLength(1);
    expect(tree().active).toBe(nodes[0].id);
    expect(nodes[0].artifacts.map((a) => [a.kind, a.ref])).toEqual([["pr", PR]]);
  });

  test("a failed call writes nothing", () => {
    openNode();
    const before = readEvents().length;
    runClaude("gh pr create --fill", "", {
      hook_event_name: "PostToolUseFailure",
      tool_response: undefined,
      error: `Exit code 1\n${PR}`,
    });
    expect(readEvents()).toHaveLength(before);
  });

  test("output with no PR URL writes nothing", () => {
    openNode();
    const before = readEvents().length;
    runClaude("gh pr create --fill", "a pull request already exists\n");
    expect(readEvents()).toHaveLength(before);
  });

  test.each(["view", "list", "checks", "merge"])("gh pr %s never attaches", (verb) => {
    openNode();
    const before = readEvents().length;
    runClaude(`gh pr ${verb} 42`, `title: x\n${PR}\n`);
    expect(readEvents()).toHaveLength(before);
  });

  test("a PR already attached by hand is not attached again", () => {
    openNode();
    attach("n1", "pr", PR);
    runClaude("gh pr create --fill", `${PR}\n`);
    expect(attachments()).toEqual([["n1", "pr", PR]]);
  });

  test("a broken progress-tree log never throws out of the hook", () => {
    mkdirSync(resolve(paths.home, "memory", "progress-tree", "events.jsonl"), {
      recursive: true,
    });
    expect(() => runClaude("gh pr create --fill", `${PR}\n`)).not.toThrow();
  });
});

describe("a published artifact attaches its URL", () => {
  const URL = "https://claude.ai/artifact/UaUjbDTmpECFALyrtswoFF";
  const published = { url: URL, title: "Suspect Van", seq: 1 };
  const runArtifact = (
    input: Record<string, unknown>,
    response: unknown = published,
    extra: Record<string, unknown> = {}
  ) =>
    runPostToolHandlers(
      {
        hook_event_name: "PostToolUse",
        session_id: SESSION,
        tool_name: "Artifact",
        tool_input: input,
        tool_response: response,
        ...extra,
      },
      ["--only=progress-tree"]
    );
  const labels = () =>
    [...tree().nodes.values()].flatMap((n) => n.artifacts.map((a) => a.label));

  test("a publish attaches the URL with the page's title to the active node", () => {
    openNode();
    runArtifact({ file_path: "/tmp/van.html", icon: "car" });
    expect(attachments()).toEqual([["n1", "artifact", URL]]);
    expect(labels()).toEqual(["Suspect Van"]);
  });

  test("an explicit publish action attaches too", () => {
    openNode();
    runArtifact({ action: "publish", file_path: "/tmp/van.html" });
    expect(attachments()).toEqual([["n1", "artifact", URL]]);
  });

  test("with no active node the session's node opens and takes the artifact", () => {
    runArtifact({ file_path: "/tmp/van.html" });
    const nodes = [...tree().nodes.values()];
    expect(nodes).toHaveLength(1);
    expect(nodes[0].artifacts.map((a) => [a.kind, a.ref])).toEqual([["artifact", URL]]);
  });

  test("a republish of the same page is not attached again", () => {
    openNode();
    runArtifact({ file_path: "/tmp/van.html" });
    runArtifact({ file_path: "/tmp/van.html" }, { ...published, seq: 2 });
    expect(attachments()).toEqual([["n1", "artifact", URL]]);
  });

  test.each([
    ["read", { action: "read", url: URL }, published],
    ["list", { action: "list" }, { artifacts: [{ url: URL }], total: 1 }],
    ["delete", { action: "delete", url: URL }, { artifact_delete: { url: URL } }],
    ["open", { action: "open", url: URL }, published],
    ["an asset upload", { url: URL, file_path: "/tmp/a.png", asset: true }, published],
  ])("%s attaches nothing", (_, input, response) => {
    openNode();
    const before = readEvents().length;
    runArtifact(input, response);
    expect(readEvents()).toHaveLength(before);
  });

  test("a failed publish attaches nothing", () => {
    openNode();
    const before = readEvents().length;
    runArtifact({ file_path: "/tmp/van.html" }, undefined, {
      hook_event_name: "PostToolUseFailure",
      error: "Publish refused",
    });
    expect(readEvents()).toHaveLength(before);
  });

  test("a result with no URL attaches nothing", () => {
    openNode();
    const before = readEvents().length;
    runArtifact({ file_path: "/tmp/van.html" }, "Published somewhere");
    expect(readEvents()).toHaveLength(before);
  });

  test("Claude Code runs the progress-tree handler on Artifact calls", async () => {
    const settings = await Bun.file(
      resolve(import.meta.dir, "../assets/templates/settings.claude.json")
    ).json();
    const matchers = (
      settings.hooks.PostToolUse as { matcher: string; hooks: { command: string }[] }[]
    )
      .filter((h) => h.hooks.some((c) => c.command.includes("--only=progress-tree")))
      .map((h) => h.matcher);
    expect(matchers.some((m) => new RegExp(`^(?:${m})$`).test("Artifact"))).toBe(true);
  });
});

describe("one payload shape per agent", () => {
  const create = "gh pr create --fill";
  const out = `${PR}\n`;
  const shapes: [string, Record<string, unknown>][] = [
    [
      "codex",
      {
        hook_event_name: "PostToolUse",
        session_id: SESSION,
        tool_name: "Bash",
        tool_input: { command: create },
        tool_response: out,
      },
    ],
    [
      "cursor",
      {
        hook_event_name: "postToolUse",
        conversation_id: SESSION,
        tool_name: "Shell",
        tool_input: { command: create },
        tool_output: out,
      },
    ],
    [
      "copilot",
      {
        sessionId: SESSION,
        toolName: "bash",
        toolArgs: JSON.stringify({ command: create }),
        toolResult: { resultType: "success", textResultForLlm: out },
      },
    ],
    [
      "antigravity",
      {
        hook_event_name: "PostToolUse",
        session_id: SESSION,
        toolCall: { name: "run_command", args: { CommandLine: create } },
        tool_response: out,
      },
    ],
    [
      "opencode",
      {
        tool_name: "bash",
        tool_input: { command: create },
        session_id: SESSION,
        tool_response: out,
      },
    ],
  ];

  test.each(shapes)("%s: the URL reaches the active node", (agent, payload) => {
    process.env.PAL_AGENT = agent;
    openNode();
    runPostToolHandlers(payload, ["--only=progress-tree"]);
    expect(attachments()).toEqual([["n1", "pr", PR]]);
  });

  test("copilot: a failed result writes nothing", () => {
    process.env.PAL_AGENT = "copilot";
    openNode();
    const before = readEvents().length;
    runPostToolHandlers(
      {
        sessionId: SESSION,
        toolName: "bash",
        toolArgs: JSON.stringify({ command: create }),
        toolResult: { resultType: "failure", textResultForLlm: out },
      },
      ["--only=progress-tree"]
    );
    expect(readEvents()).toHaveLength(before);
  });

  test("Claude Code's post-tool registration runs the progress-tree handler", async () => {
    const template = await Bun.file(
      resolve(import.meta.dir, "../assets/templates/settings.claude.json")
    ).text();
    expect(template).toContain(
      "PostToolOrchestrator.ts --agent=claude --only=progress-tree"
    );
  });
});

describe("a started factory build attaches its task", () => {
  const BUILD = "node /plugins/dark-factory/scripts/build.mjs";

  test("in the foreground", () => {
    openNode();
    runClaude(`${BUILD} ${TASK}`, "building...\n");
    expect(attachments()).toEqual([["n1", "run", `dark-factory:${TASK}`]]);
  });

  test("in the background", () => {
    openNode();
    runClaude(`${BUILD} ${TASK} > /tmp/build.log 2>&1 &`, "", {
      tool_input: {
        command: `${BUILD} ${TASK} > /tmp/build.log 2>&1 &`,
        run_in_background: true,
      },
    });
    expect(attachments()).toEqual([["n1", "run", `dark-factory:${TASK}`]]);
  });

  test("a command that only names the script, like git add, attaches nothing", () => {
    openNode();
    runClaude(
      "git add assets/plugins/dark-factory/scripts/build.mjs assets/plugins/dark-factory/scripts/roles.mjs"
    );
    runClaude("cat /plugins/dark-factory/scripts/build.mjs | head");
    expect(attachments()).toEqual([]);
  });

  test("the same task is not attached twice", () => {
    openNode();
    runClaude(`${BUILD} ${TASK}`);
    runClaude(`${BUILD} ${TASK}`);
    expect(attachments()).toEqual([["n1", "run", `dark-factory:${TASK}`]]);
  });
});

describe("the factory's PR reaches the node holding the task", () => {
  test.each(["pr_opened", "pr_adopted"])("%s attaches at session start", (event) => {
    nodeHoldingTask();
    factoryEvent(event, TASK);
    sessionStart();
    expect(attachments()).toContainEqual(["n1", "pr", PR]);
  });

  test("goes to the node holding that task, not the active one", () => {
    nodeHoldingTask("n1");
    openNode("n2");
    factoryEvent("pr_opened", TASK);
    sessionStart();
    const holders = attachments().filter(([, kind]) => kind === "pr");
    expect(holders).toEqual([["n1", "pr", PR]]);
  });

  test("a task no node holds attaches nothing", () => {
    nodeHoldingTask();
    factoryEvent("pr_opened", OTHER_TASK, "https://github.com/acme/widgets/pull/7");
    sessionStart();
    expect(attachments().filter(([, kind]) => kind === "pr")).toEqual([]);
  });

  test("two tasks on one node reporting the same PR attach it once", () => {
    nodeHoldingTask();
    attach("n1", "run", `dark-factory:${OTHER_TASK}`);
    factoryEvent("pr_adopted", TASK);
    factoryEvent("pr_opened", OTHER_TASK);
    sessionStart();
    expect(attachments().filter(([, kind]) => kind === "pr")).toEqual([["n1", "pr", PR]]);
  });

  test("a missing factory log writes nothing and fails nothing", () => {
    nodeHoldingTask();
    const before = readEvents().length;
    expect(() => sessionStart()).not.toThrow();
    expect(readEvents()).toHaveLength(before);
  });

  test("a line that does not parse is skipped and the rest still count", () => {
    nodeHoldingTask();
    appendFileSync(paths.factoryLog, "{not json\n");
    factoryEvent("pr_opened", TASK);
    expect(() => sessionStart()).not.toThrow();
    expect(attachments()).toContainEqual(["n1", "pr", PR]);
  });

  test("only the session's own scope is checked", () => {
    nodeHoldingTask();
    const elsewhere = resolve(paths.home, "elsewhere");
    mkdirSync(elsewhere, { recursive: true });
    appendEvent(
      elsewhere,
      "x1",
      "open",
      { title: "Other", parent: null },
      undefined,
      undefined,
      SESSION
    );
    appendEvent(
      elsewhere,
      "x1",
      "attach",
      { kind: "run", ref: `dark-factory:${OTHER_TASK}` },
      undefined,
      undefined,
      SESSION
    );
    factoryEvent("pr_opened", OTHER_TASK, "https://github.com/acme/widgets/pull/7");
    sessionStart();
    const other = readTree(elsewhere, undefined, SESSION).nodes.get("x1");
    expect(other?.artifacts.filter((a) => a.kind === "pr")).toEqual([]);
  });

  test("the factory log is read without being changed", () => {
    nodeHoldingTask();
    factoryEvent("pr_opened", TASK);
    const before = readFileSync(paths.factoryLog, "utf-8");
    sessionStart();
    expect(readFileSync(paths.factoryLog, "utf-8")).toEqual(before);
  });
});
