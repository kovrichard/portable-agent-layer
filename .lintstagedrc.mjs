const commit = process.env.LINT_STAGE === "commit";
const githubActions = Boolean(process.env.GITHUB_ACTIONS);

const gates = [
  githubActions ? "check --reporter=github" : "check",
  "type-check",
  "knip",
  "jscpd",
  // 2026-11-28: klint 1.13 reports findings as PR annotations in CI, like Biome above
  commit ? (githubActions ? "klint:github" : "klint") : "klint:hook",
  "madge",
  "lf",
  "exact-versions",
  "lock:check",
  "secretlint",
];

const afterGates = commit ? ["test --fast --only-failures"] : [];

const run = (script) => () => `bun run ${script}`;

export default {
  "*": [gates.map(run), ...afterGates.map(run)],
};
