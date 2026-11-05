// assets/plugins/dark-factory/scripts/build.mjs
function runRole(run, role, instructions, { tier } = {}) {
  const model = tier ? TIER_MODELS[tier] : undefined;
  appendEvent(
    { event: "role_run", task: run.id, role, model: model ?? "default" },
    run.env
  );
  const outcome = runRoleHeadless(run.id, role, { env: run.env, model, instructions });
  return afterQuestion(run, role, outcome, model);
}

// assets/plugins/dark-factory/scripts/role.mjs
const ROLE_INSTRUCTIONS = {
  architect: "Write design.md for this change.",
  planner: "Write plan.md for this change.",
  debugger:
    "Reproduce the bug described in the spec and write repro.md with the root cause.",
  "test-writer":
    "Write the failing tests for every acceptance criterion and leave them uncommitted; the code writer commits them with the code.",
  "code-writer":
    "Implement the change described in plan.md when it exists, otherwise in the spec.",
  reviewer:
    "Review the branch diff against its base and the spec. Report each finding with its file, line, what is wrong and what would fix it.",
  tester:
    "Test every acceptance criterion in the running app. Report each criterion as met or not met, with what you did and what you saw.",
  po: 'Read the spec and list every question in it that only the user can answer, or reply "No questions." when there are none.',
};

function askLine(role) {
  return schemaFor(role).properties.question
    ? "Never ask the user anything. If you cannot continue without an answer, set question and stop."
    : "Never ask the user anything.";
}

export function rolePrompt(
  task,
  role,
  instructions = ROLE_INSTRUCTIONS[role],
  env = process.env
) {
  const folder = taskDir(task.id, env);
  return [
    `Task ${task.id}: ${task.title}`,
    `Task folder: ${folder} (the spec is ${join(folder, "spec.md")}; plan.md, design.md, repro.md and tests.md live here when they exist).`,
    `Work only inside the git worktree ${task.worktree}. The branch is ${task.branch}, based on ${task.base}.`,
    ONE_COMMAND_PER_CALL,
    askLine(role),
    "",
    instructions,
  ].join("\n");
}

function promptFor(task, role, { instructions, resumeSessionId, env }) {
  return resumeSessionId ? instructions : rolePrompt(task, role, instructions, env);
}

// assets/plugins/dark-factory/scripts/lib.mjs
export function appendEvent(event, env = process.env, now = new Date()) {
  const file = eventsFile(env);
  mkdirSync(dirname(file), { recursive: true });
  const line = `${JSON.stringify({ ts: now.toISOString(), ...event })}\n`;
  appendFileSync(file, line);
  appendToTaskLog(event.task, line, env);
}
