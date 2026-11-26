const commit = process.env.LINT_STAGE === "commit";
const githubActions = Boolean(process.env.GITHUB_ACTIONS);

const gates = [
  githubActions ? "check --reporter=github" : "check",
  "type-check",
  "knip",
  "jscpd",
  commit ? "klint" : "klint:hook",
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
