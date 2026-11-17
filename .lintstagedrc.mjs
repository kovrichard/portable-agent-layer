const commit = process.env.LINT_STAGE === "commit";

const gates = [
  "check",
  "type-check",
  "knip",
  "jscpd",
  "klint",
  "madge",
  "lf",
  "exact-versions",
  "lock:check",
  "secretlint",
  ...(commit ? ["test --fast --only-failures"] : []),
];

export default {
  "*": [gates.map((gate) => () => `bun run ${gate}`)],
};
