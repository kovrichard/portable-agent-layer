export type Level = "pass" | "warn" | "error";

export type AddFinding = (level: Level, check: string, message: string) => void;

/** Model values PAL recognises across agents; anything else warns (naming drifts). */
const KNOWN_MODELS = ["inherit", "fable", "sonnet", "opus", "haiku"];
const PERMISSION_VALUES = ["allow", "ask", "deny"];
const OPENCODE_MODES = ["subagent", "primary", "all"];
const CODEX_SANDBOX_MODES = ["read-only", "workspace-write", "danger-full-access"];
const CODEX_TABLE_KEYS = ["tools", "skills"];
const ANTIGRAVITY_MODELS = ["inherit", "flash", "pro"];
const ANTIGRAVITY_TOOLS = [
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

/** Value of a single-line `key: value` field within an un-indented block. */
function fieldValue(lines: string[], key: string): string | null {
  const re = new RegExp(String.raw`^${key}:[ \t]*(.*?)\s*$`);

  for (const line of lines) {
    const m = re.exec(line);
    if (m) return m[1].replace(/^"(.*)"$/, "$1");
  }

  return null;
}

export function topLevelKeys(lines: string[]): string[] {
  return lines.flatMap((line) => /^([A-Za-z0-9_-]+):/.exec(line)?.[1] ?? []);
}

/** True when a block declares `key:` (with or without an inline value). */
export function hasField(lines: string[], key: string): boolean {
  return lines.some((l) => new RegExp(`^${key}:`).test(l));
}

export function checkClaudeBlock(lines: string[], add: AddFinding): void {
  const model = fieldValue(lines, "model");
  if (model) validateModel(model, "claude", add);
  const tools = fieldValue(lines, "tools");
  if (tools !== null && tools.trim() === "") {
    add("warn", "claude.tools", "`tools` is empty — omit it to inherit all tools");
  }
}

export function checkOpencodeBlock(lines: string[], add: AddFinding): void {
  const mode = fieldValue(lines, "mode");
  if (!mode) {
    add(
      "warn",
      "opencode.mode",
      "no `mode` — set `mode: subagent` so opencode treats it as a delegate"
    );
  } else if (!OPENCODE_MODES.includes(mode)) {
    add(
      "warn",
      "opencode.mode",
      `mode "${mode}" — expected one of ${OPENCODE_MODES.join(", ")}`
    );
  } else if (mode !== "subagent") {
    add("warn", "opencode.mode", `mode is "${mode}", not "subagent" — intended?`);
  }

  const model = fieldValue(lines, "model");
  if (model) validateModel(model, "opencode", add);

  for (const line of lines) {
    const perm = /^\s*(read|write|edit|bash|webfetch|skill):\s*"?([a-z-]+)"?\s*$/.exec(
      line
    );
    if (perm && !PERMISSION_VALUES.includes(perm[2])) {
      add(
        "warn",
        "opencode.permission",
        `${perm[1]}: "${perm[2]}" — expected ${PERMISSION_VALUES.join("/")}`
      );
    }
  }
}

export function checkCursorBlock(lines: string[], add: AddFinding): void {
  const model = fieldValue(lines, "model");
  if (model) validateModel(model, "cursor", add);

  for (const key of ["readonly", "is_background"]) {
    const v = fieldValue(lines, key);
    if (v !== null && v !== "true" && v !== "false") {
      add("warn", `cursor.${key}`, `${key}: "${v}" — must be true or false`);
    }
  }
}

export function checkCopilotBlock(lines: string[], add: AddFinding): void {
  const model = fieldValue(lines, "model");
  if (model) validateModel(model, "copilot", add);
}

export function checkCodexBlock(lines: string[], add: AddFinding): void {
  const model = fieldValue(lines, "model");
  if (model) validateModel(model, "codex", add);
  const sandbox = fieldValue(lines, "sandbox_mode");
  if (sandbox !== null && !CODEX_SANDBOX_MODES.includes(sandbox)) {
    add(
      "warn",
      "codex.sandbox_mode",
      `sandbox_mode "${sandbox}" — expected one of ${CODEX_SANDBOX_MODES.join(", ")}`
    );
  }

  for (const key of CODEX_TABLE_KEYS.filter((k) => hasField(lines, k))) {
    add(
      "warn",
      `codex.${key}`,
      `Codex reads \`${key}\` as a config table, not a list — the agent will not load; name tools or skills in the body instead`
    );
  }
}

export function checkAntigravityBlock(lines: string[], add: AddFinding): void {
  const model = fieldValue(lines, "model");
  if (model !== null && !ANTIGRAVITY_MODELS.includes(model)) {
    add(
      "warn",
      "antigravity.model",
      `model "${model}" — expected one of ${ANTIGRAVITY_MODELS.join(", ")}`
    );
  }

  checkAntigravityTools(antigravityTools(lines), add);
}

function antigravityTools(lines: string[]): unknown {
  try {
    return (Bun.YAML.parse(lines.join("\n")) as { tools?: unknown } | null)?.tools;
  } catch {
    return "unparseable";
  }
}

function checkAntigravityTools(tools: unknown, add: AddFinding): void {
  if (tools === undefined || tools === null || (Array.isArray(tools) && !tools.length)) {
    add(
      "warn",
      "antigravity.tools",
      "no `tools` — Antigravity gives the subagent no tools at all; list the ones it needs"
    );

    return;
  }

  if (!Array.isArray(tools) || !tools.every((t) => typeof t === "string")) {
    add("error", "antigravity.tools", "`tools` must be a YAML list of tool names");

    return;
  }

  const unknown = tools.filter((t) => !ANTIGRAVITY_TOOLS.includes(t));
  unknown.length > 0
    ? add(
        "error",
        "antigravity.tools",
        `unknown tool(s) ${unknown.join(", ")} — an unmapped tool name can hang the subagent; use Antigravity names such as run_command, view_file, search_web`
      )
    : add("pass", "antigravity.tools", `${tools.length} known tool(s)`);
}

function validateModel(model: string, platform: string, add: AddFinding): void {
  const known = KNOWN_MODELS.includes(model) || /^(claude-|gpt-|o\d|gemini-)/.test(model);
  if (!known) {
    add(
      "warn",
      `${platform}.model`,
      `model "${model}" is unrecognised — confirm it is a valid ${platform} model id/alias`
    );
  }
}
