import { spawnSync } from "node:child_process";
import { isMain, printJson, readRepoConfig } from "./lib.mjs";

export const CATEGORIES = {
  small: { before: [], after: ["reviewer"] },
  bug: { before: ["debugger", "test-writer"], after: ["reviewer"] },
  feature: { before: ["planner", "test-writer"], after: ["reviewer", "tester"] },
  "big-feature": {
    before: ["architect", "planner", "test-writer"],
    after: ["reviewer", "tester"],
  },
  refactor: { before: ["planner"], after: ["reviewer"] },
};

export function rolesFor(category) {
  const roles = CATEGORIES[category];
  if (!roles)
    throw new Error(
      `unknown category "${category}"; use one of ${Object.keys(CATEGORIES).join(", ")}`
    );
  return roles;
}

const ROLE_RESULT = {
  type: "object",
  properties: {
    done: { type: "boolean" },
    summary: { type: "string" },
    question: {
      type: "string",
      description: "Set only when you cannot continue without an answer",
    },
  },
  required: ["done", "summary"],
};

const PO_RESULT = {
  type: "object",
  properties: { answer: { type: "string" }, userQuestion: { type: "string" } },
};

const REVIEW_RESULT = {
  type: "object",
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          file: { type: "string" },
          line: { type: "number" },
          problem: { type: "string" },
          fix: { type: "string" },
        },
        required: ["file", "problem", "fix"],
      },
    },
  },
  required: ["findings"],
};

const TEST_RESULT = {
  type: "object",
  properties: {
    criteria: {
      type: "array",
      items: {
        type: "object",
        properties: {
          criterion: { type: "string" },
          met: { type: "boolean" },
          evidence: { type: "string" },
        },
        required: ["criterion", "met", "evidence"],
      },
    },
  },
  required: ["criteria"],
};

export const RESULT_SCHEMAS = { ROLE_RESULT, PO_RESULT, REVIEW_RESULT, TEST_RESULT };

const ROLE_SCHEMAS = {
  reviewer: REVIEW_RESULT,
  tester: TEST_RESULT,
  po: PO_RESULT,
};

export function schemaFor(role) {
  return Object.hasOwn(ROLE_SCHEMAS, role) ? ROLE_SCHEMAS[role] : ROLE_RESULT;
}

const READS = ["Read", "Grep", "Glob"];
const READ_ONLY_SHELL = [
  "Bash(git diff *)",
  "Bash(git log *)",
  "Bash(git show *)",
  "Bash(git status *)",
  "Bash(git rev-parse *)",
  "Bash(git merge-base *)",
  "Bash(git blame *)",
  "Bash(gh pr view *)",
  "Bash(gh pr diff *)",
];
const EDITS = ["Edit", "Write", "NotebookEdit"];
const FILE_WRITING_GIT_FLAGS = ["git diff", "git log", "git show"].flatMap((command) => [
  `Bash(${command} *--output*)`,
  `Bash(${command} *--ext-diff*)`,
]);
const READ_ONLY_DENY = [...EDITS, ...FILE_WRITING_GIT_FLAGS];

export const ROLE_POLICIES = {
  reviewer: { allow: [...READS, ...READ_ONLY_SHELL], deny: READ_ONLY_DENY, budgetUsd: 2 },
  po: { allow: [...READS, ...READ_ONLY_SHELL], deny: READ_ONLY_DENY, budgetUsd: 1 },
  tester: { allow: [...READS, "Bash"], deny: EDITS, budgetUsd: 3 },
  architect: {
    allow: [...READS, ...READ_ONLY_SHELL, "Edit", "Write"],
    deny: ["NotebookEdit"],
    budgetUsd: 3,
  },
  planner: {
    allow: [...READS, ...READ_ONLY_SHELL, "Edit", "Write"],
    deny: ["NotebookEdit"],
    budgetUsd: 3,
  },
  "test-writer": { allow: [...READS, "Edit", "Write", "Bash"], deny: [], budgetUsd: 3 },
  "code-writer": { allow: [...READS, "Edit", "Write", "Bash"], deny: [], budgetUsd: 2 },
  debugger: { allow: [...READS, "Edit", "Write", "Bash"], deny: [], budgetUsd: 5 },
};

export function policyFor(role) {
  if (!Object.hasOwn(ROLE_POLICIES, role))
    throw new Error(
      `unknown role "${role}"; use one of ${Object.keys(ROLE_POLICIES).join(", ")}`
    );
  return ROLE_POLICIES[role];
}

function touchesUi(changedFiles, uiPaths = []) {
  return changedFiles.some((file) => uiPaths.some((prefix) => file.startsWith(prefix)));
}

export function rolesAfterDiff(category, changedFiles, config) {
  const after = [...rolesFor(category).after];
  if (!after.includes("tester") && touchesUi(changedFiles, config.uiPaths))
    after.push("tester");
  return after;
}

export function changedFilesSince(repo, base, env) {
  const result = spawnSync("git", ["diff", "--name-only", `${base}...HEAD`], {
    cwd: repo,
    encoding: "utf8",
    env,
  });
  if (result.status !== 0) throw new Error(`git diff failed: ${result.stderr}`);
  return result.stdout.split("\n").filter(Boolean);
}

export function rolesAfter(
  category,
  repo,
  base,
  env = process.env,
  config = readRepoConfig(repo)
) {
  const roles = rolesAfterDiff(category, changedFilesSince(repo, base, env), config);
  const added = roles.filter((role) => !rolesFor(category).after.includes(role));
  return { roles, added };
}

if (isMain(import.meta.url)) {
  const [mode, category, repo, base] = process.argv.slice(2);
  if (mode === "before") printJson(rolesFor(category).before);
  else printJson(rolesAfter(category, repo, base));
}
