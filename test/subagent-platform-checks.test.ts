import { describe, expect, test } from "bun:test";
import {
  type AddFinding,
  checkAntigravityBlock,
  checkClaudeBlock,
  checkCodexBlock,
  checkCopilotBlock,
  checkCursorBlock,
  checkOpencodeBlock,
  hasField,
  topLevelKeys,
} from "../src/tools/subagent-platform-checks";

type Check = (lines: string[], add: AddFinding) => void;

function verdicts(check: Check, lines: string[]): string[] {
  const out: string[] = [];
  check(lines, (level, name, message) => out.push(`${level} ${name}: ${message}`));

  return out;
}

const unrecognised = (platform: string, model: string) =>
  `warn ${platform}.model: model "${model}" is unrecognised — confirm it is a valid ${platform} model id/alias`;

const NO_TOOLS =
  "warn antigravity.tools: no `tools` — Antigravity gives the subagent no tools at all; list the ones it needs";
const NOT_A_LIST = "error antigravity.tools: `tools` must be a YAML list of tool names";
const CODEX_TABLE = (key: string) =>
  `warn codex.${key}: Codex reads \`${key}\` as a config table, not a list — the agent will not load; name tools or skills in the body instead`;

describe("topLevelKeys", () => {
  test("lists only un-indented keys, allowing letters, digits, _ and -", () => {
    expect(
      topLevelKeys([
        "model: fable",
        "  nested: x",
        "Tools:",
        "a_b-9: z",
        "no colon here",
        "two words: x",
        "- item",
      ])
    ).toEqual(["model", "Tools", "a_b-9"]);
  });

  test("an empty block has no keys", () => {
    expect(topLevelKeys([])).toEqual([]);
  });
});

describe("hasField", () => {
  test.each([
    [["tools:"], true],
    [["model: x", "tools: Read"], true],
    [["  tools:"], false],
    [["pretools: x"], false],
    [["toolsx: x"], false],
    [[], false],
  ])("%p declares tools: %p", (lines, expected) => {
    expect(hasField(lines, "tools")).toBe(expected);
  });
});

describe("model validation shared by every platform but antigravity", () => {
  test.each([
    "inherit",
    "fable",
    "sonnet",
    "opus",
    "haiku",
    "claude-x-1",
    "gpt-6",
    "o3",
    "gemini-3-pro",
  ])("%s is recognised", (model) => {
    expect(verdicts(checkCopilotBlock, [`model: ${model}`])).toEqual([]);
  });

  test.each(["turbo", "o", "omni", "my-claude-x", "xgpt-5", "Gemini-3"])(
    "%s warns as unrecognised",
    (model) => {
      expect(verdicts(checkCopilotBlock, [`model: ${model}`])).toEqual([
        unrecognised("copilot", model),
      ]);
    }
  );

  test.each([
    ["claude", checkClaudeBlock],
    ["cursor", checkCursorBlock],
    ["codex", checkCodexBlock],
    ["copilot", checkCopilotBlock],
  ] as const)("the %s check names its own platform", (platform, check) => {
    expect(verdicts(check, ["model: turbo"])).toEqual([unrecognised(platform, "turbo")]);
  });

  test("the opencode check names its own platform", () => {
    expect(verdicts(checkOpencodeBlock, ["mode: subagent", "model: turbo"])).toEqual([
      unrecognised("opencode", "turbo"),
    ]);
  });

  test.each([
    ["no space after the colon", "model:turbo"],
    ["a quoted value", 'model: "turbo"'],
    ["trailing whitespace", "model: turbo  \t"],
    ["a tab before the value", "model:\tturbo"],
  ])("the model value is read with %s", (_case, line) => {
    expect(verdicts(checkCopilotBlock, [line])).toEqual([
      unrecognised("copilot", "turbo"),
    ]);
  });

  test.each([
    ["an indented model", ["  model: turbo"]],
    ["a key that only starts with model", ["models: turbo"]],
    ["no model", ["tools: Read"]],
    ["an empty model", ["model:"]],
  ])("%s is not validated", (_case, lines) => {
    expect(verdicts(checkCopilotBlock, lines)).toEqual([]);
  });

  test.each(['"fable', 'x"fable"', '"fable" x'])(
    "only a fully quoted value is unquoted, so %s stays as written",
    (model) => {
      expect(verdicts(checkCopilotBlock, [`model: ${model}`])).toEqual([
        unrecognised("copilot", model),
      ]);
    }
  );

  test("the first model line wins", () => {
    expect(verdicts(checkCopilotBlock, ["model: fable", "model: turbo"])).toEqual([]);
  });
});

describe("checkClaudeBlock", () => {
  test.each([
    [["tools:"], ["warn claude.tools: `tools` is empty — omit it to inherit all tools"]],
    [
      ["tools:   "],
      ["warn claude.tools: `tools` is empty — omit it to inherit all tools"],
    ],
    [["tools: Read, Grep"], []],
    [["model: fable"], []],
    [[], []],
  ])("%p → %p", (lines, expected) => {
    expect(verdicts(checkClaudeBlock, lines)).toEqual(expected);
  });
});

describe("checkOpencodeBlock", () => {
  test.each([
    [
      [],
      [
        "warn opencode.mode: no `mode` — set `mode: subagent` so opencode treats it as a delegate",
      ],
    ],
    [
      ["mode:"],
      [
        "warn opencode.mode: no `mode` — set `mode: subagent` so opencode treats it as a delegate",
      ],
    ],
    [
      ["mode: helper"],
      ['warn opencode.mode: mode "helper" — expected one of subagent, primary, all'],
    ],
    [
      ["mode: primary"],
      ['warn opencode.mode: mode is "primary", not "subagent" — intended?'],
    ],
    [["mode: all"], ['warn opencode.mode: mode is "all", not "subagent" — intended?']],
    [["mode: subagent"], []],
  ])("mode %p → %p", (lines, expected) => {
    expect(verdicts(checkOpencodeBlock, lines)).toEqual(expected);
  });

  test("every permission key with a bad value warns, valid ones pass", () => {
    const lines = [
      "mode: subagent",
      "permission:",
      "  read: maybe",
      '  write: "never"',
      "  edit: allow",
      "  bash: ask",
      '  webfetch: "deny"',
      "  skill: perhaps",
      "  other: maybe",
      "  read: Allow",
      "  xread: maybe",
      "  edit: maybe later",
      "  bash:never",
    ];
    expect(verdicts(checkOpencodeBlock, lines)).toEqual([
      'warn opencode.permission: read: "maybe" — expected allow/ask/deny',
      'warn opencode.permission: write: "never" — expected allow/ask/deny',
      'warn opencode.permission: skill: "perhaps" — expected allow/ask/deny',
      'warn opencode.permission: bash: "never" — expected allow/ask/deny',
    ]);
  });

  test("a permission written at the top level is still checked", () => {
    expect(verdicts(checkOpencodeBlock, ["mode: subagent", "bash: sometimes  "])).toEqual(
      ['warn opencode.permission: bash: "sometimes" — expected allow/ask/deny']
    );
  });
});

describe("checkCursorBlock", () => {
  test.each([
    [["readonly: true", "is_background: false"], []],
    [[], []],
    [
      ["readonly: yes"],
      ['warn cursor.readonly: readonly: "yes" — must be true or false'],
    ],
    [
      ["is_background: 1"],
      ['warn cursor.is_background: is_background: "1" — must be true or false'],
    ],
    [["readonly:"], ['warn cursor.readonly: readonly: "" — must be true or false']],
  ])("%p → %p", (lines, expected) => {
    expect(verdicts(checkCursorBlock, lines)).toEqual(expected);
  });
});

describe("checkCodexBlock", () => {
  test.each(["read-only", "workspace-write", "danger-full-access"])(
    "sandbox_mode %s passes",
    (mode) => {
      expect(verdicts(checkCodexBlock, [`sandbox_mode: ${mode}`])).toEqual([]);
    }
  );

  test("an unknown sandbox_mode warns with the allowed values", () => {
    expect(verdicts(checkCodexBlock, ["sandbox_mode: open"])).toEqual([
      'warn codex.sandbox_mode: sandbox_mode "open" — expected one of read-only, workspace-write, danger-full-access',
    ]);
  });

  test("tools and skills tables each warn, in that order", () => {
    expect(verdicts(checkCodexBlock, ["skills:", "  - a", "tools:", "  - b"])).toEqual([
      CODEX_TABLE("tools"),
      CODEX_TABLE("skills"),
    ]);
  });

  test("a block with neither table adds no findings", () => {
    expect(verdicts(checkCodexBlock, ["model: gpt-6"])).toEqual([]);
  });
});

describe("checkAntigravityBlock", () => {
  const tools = ["tools:", "  - view_file", "  - run_command"];

  test.each(["inherit", "flash", "pro"])("model %s passes", (model) => {
    expect(verdicts(checkAntigravityBlock, [`model: ${model}`, ...tools])).toEqual([
      "pass antigravity.tools: 2 known tool(s)",
    ]);
  });

  test("any other model warns with the allowed values", () => {
    expect(verdicts(checkAntigravityBlock, ["model: fable", ...tools])).toEqual([
      'warn antigravity.model: model "fable" — expected one of inherit, flash, pro',
      "pass antigravity.tools: 2 known tool(s)",
    ]);
  });

  test("every Antigravity tool name is known", () => {
    const all = [
      "view_file",
      "write_to_file",
      "replace_file_content",
      "multi_replace_file_content",
      "list_dir",
      "find_by_name",
      "grep_search",
      "search_web",
      "read_url_content",
      "run_command",
      "manage_task",
      "schedule",
      "list_permissions",
      "ask_permission",
      "invoke_subagent",
      "define_subagent",
      "send_message",
      "manage_subagents",
      "ask_question",
      "generate_image",
    ];
    expect(
      verdicts(checkAntigravityBlock, ["tools:", ...all.map((t) => `  - ${t}`)])
    ).toEqual([`pass antigravity.tools: ${all.length} known tool(s)`]);
  });

  test.each([
    ["no lines", [], [NO_TOOLS]],
    ["a null tools value", ["tools: null"], [NO_TOOLS]],
    ["a list holding a number", ["tools:", "  - view_file", "  - 3"], [NOT_A_LIST]],
    ["a single string", ["tools: view_file"], [NOT_A_LIST]],
    ["unparseable YAML", ["tools: [view_file"], [NOT_A_LIST]],
    [
      "unknown names",
      ["tools: [view_file, Bash, Grep]"],
      [
        "error antigravity.tools: unknown tool(s) Bash, Grep — an unmapped tool name can hang the subagent; use Antigravity names such as run_command, view_file, search_web",
      ],
    ],
  ])("%s", (_case, lines, expected) => {
    expect(verdicts(checkAntigravityBlock, lines)).toEqual(expected);
  });
});
