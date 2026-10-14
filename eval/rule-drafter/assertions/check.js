const { resolve } = require("node:path");
const { spawnSync } = require("node:child_process");

const CHECK = resolve(__dirname, "../check.ts");

module.exports = function check(output, caseId, mode) {
  const result = spawnSync("bun", [CHECK, ...(mode ? [mode] : [])], {
    input: JSON.stringify({ caseId, output: String(output) }),
    encoding: "utf-8",
  });
  if (result.status !== 0)
    return {
      pass: false,
      score: 0,
      reason: (result.stderr ?? "").trim() || "check failed",
    };
  const { pass, reason } = JSON.parse(result.stdout);
  return { pass, score: pass ? 1 : 0, reason };
};
