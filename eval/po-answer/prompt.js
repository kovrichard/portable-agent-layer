const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const CURRENT = join(__dirname, "../../assets/plugins/dark-factory/agents/po.md");
const BASELINE = join(__dirname, "baseline-po.md");

function bodyOf(file) {
  return readFileSync(file, "utf8")
    .replace(/^---[\s\S]*?---\n/, "")
    .trim();
}

function poPrompt(agentFile, { vars }) {
  return `${bodyOf(agentFile)}

<spec>
${vars.spec}
</spec>

<repository_excerpt>
${vars.code || "(none)"}
</repository_excerpt>

The ${vars.role} asks: ${vars.question}

Answer it from the spec and the repository, or return userQuestion if only the user can answer it.

Respond with ONLY a JSON object, no prose: {"answer": "..."} or {"userQuestion": "..."}.`;
}

module.exports.current = (context) => poPrompt(CURRENT, context);
module.exports.baseline = (context) => poPrompt(BASELINE, context);
