const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const CURRENT = join(__dirname, "../../assets/plugins/dark-factory/agents/planner.md");
const BASELINE = join(__dirname, "baseline-planner.md");

function bodyOf(file) {
  return readFileSync(file, "utf8")
    .replace(/^---[\s\S]*?---\n/, "")
    .trim();
}

function plannerPrompt(agentFile, { vars }) {
  return `${bodyOf(agentFile)}

<spec>
${vars.spec}
</spec>

<repository_excerpt>
${vars.code || "(none)"}
</repository_excerpt>

You cannot open files: the excerpt above is the part of the repository you can see. Write plan.md for this change. Respond with only the contents of plan.md, in Markdown.`;
}

module.exports.current = (context) => plannerPrompt(CURRENT, context);
module.exports.baseline = (context) => plannerPrompt(BASELINE, context);
