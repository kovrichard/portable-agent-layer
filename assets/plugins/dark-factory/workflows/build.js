export const meta = {
  name: 'build',
  description: 'Build one dark-factory task into a green, reviewed pull request',
  whenToUse: 'Started by the dark-factory PO with args {task, pluginRoot} once the user approved the spec',
  phases: [
    { title: 'Prepare', detail: 'worktree and roles for the task category' },
    { title: 'Specify', detail: 'design, plan, reproduction and failing tests' },
    { title: 'Code', detail: 'code writer, escalating until the gate passes' },
    { title: 'Review', detail: 'reviewer and tester, with fix rounds' },
    { title: 'Ship', detail: 'sync, push, PR, CI until green' },
  ],
}

const MODELS = { small: 'claude-haiku-5-5', medium: 'claude-sonnet-5-5', large: 'claude-opus-5-5' }
const CODE_LADDER = [
  { role: 'code-writer', tier: 'small' },
  { role: 'code-writer', tier: 'small' },
  { role: 'code-writer', tier: 'medium' },
  { role: 'code-writer', tier: 'medium' },
  { role: 'debugger', tier: 'large' },
  { role: 'debugger', tier: 'large' },
]
const FIX_LADDER = CODE_LADDER.slice(2)
const REVIEW_ROUNDS = 2
const CI_ROUNDS = 3
const CI_POLLS = 6

const { task, pluginRoot } = args
const S = `node ${quoted(pluginRoot)}/scripts`
const trace = []
let attempt = 0

const SCRIPT_RESULT = {
  type: 'object',
  properties: { exitCode: { type: 'number' }, stdout: { type: 'string' } },
  required: ['exitCode', 'stdout'],
}
const ROLE_RESULT = {
  type: 'object',
  properties: {
    done: { type: 'boolean' },
    summary: { type: 'string' },
    question: { type: 'string', description: 'Set only when you cannot continue without an answer' },
  },
  required: ['done', 'summary'],
}
const PO_RESULT = {
  type: 'object',
  properties: { answer: { type: 'string' }, userQuestion: { type: 'string' } },
}
const REVIEW_RESULT = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: { file: { type: 'string' }, line: { type: 'number' }, problem: { type: 'string' }, fix: { type: 'string' } },
        required: ['file', 'problem', 'fix'],
      },
    },
  },
  required: ['findings'],
}
const TEST_RESULT = {
  type: 'object',
  properties: {
    criteria: {
      type: 'array',
      items: {
        type: 'object',
        properties: { criterion: { type: 'string' }, met: { type: 'boolean' }, evidence: { type: 'string' } },
        required: ['criterion', 'met', 'evidence'],
      },
    },
  },
  required: ['criteria'],
}

async function script(command, phase, label) {
  const result = await agent(
    `Run exactly this command with the Bash tool and nothing else, with a 10 minute timeout:\n\n${command}\n\nReturn its exit code and its stdout verbatim.`,
    { label, phase, model: MODELS.small, effort: 'low', schema: SCRIPT_RESULT },
  )
  return result ?? { exitCode: 1, stdout: '' }
}

function quoted(text) {
  const escapedQuote = "'\\''"
  return `'${String(text).replaceAll("'", escapedQuote)}'`
}

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

function utf8ByteString(text) {
  return encodeURIComponent(text).replace(/%([0-9A-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
}

function base64Of(byteString) {
  let encoded = ''
  for (let offset = 0; offset < byteString.length; offset += 3) {
    const group =
      (byteString.charCodeAt(offset) << 16) |
      ((byteString.charCodeAt(offset + 1) || 0) << 8) |
      (byteString.charCodeAt(offset + 2) || 0)
    const kept = Math.min(byteString.length - offset, 3) + 1
    const sextets = [18, 12, 6, 0].slice(0, kept).map((shift) => BASE64_ALPHABET[(group >> shift) & 63])
    encoded += sextets.join('') + '='.repeat(4 - kept)
  }
  return encoded
}

function parsed(result) {
  try {
    return JSON.parse(result.stdout.trim().split('\n').pop())
  } catch {
    return null
  }
}

function context(p) {
  return [
    `Task folder: ${p.taskDir} (the spec is ${p.specPath}; plan.md, design.md, repro.md and tests.md live here when they exist).`,
    `Work only inside the git worktree ${p.worktree}; cd into it first. The branch is ${p.branch}, based on ${p.base}.`,
    'Never ask the user anything. If you cannot continue without an answer, set question and stop.',
  ].join('\n')
}

async function askPo(p, role, question) {
  const reply = await agent(
    `${context(p)}\n\nThe ${role} asks: ${question}\n\nAnswer it, or return userQuestion if only the user can answer.`,
    { agentType: 'dark-factory:po', phase: 'Specify', label: `po:${role}`, schema: PO_RESULT },
  )
  trace.push({ event: 'po_question', role, toUser: Boolean(reply?.userQuestion) })
  return reply ?? { userQuestion: question }
}

async function runRole(p, role, instructions, { tier, phase, schema = ROLE_RESULT } = {}) {
  const model = tier ? MODELS[tier] : undefined
  trace.push({ event: 'role_run', role, model: model ?? 'default' })
  const prompt = `${context(p)}\n\n${instructions}`
  const result = await agent(prompt, { agentType: `dark-factory:${role}`, model, phase, label: role, schema })
  if (!result?.question) return result
  const reply = await askPo(p, role, result.question)
  if (reply.userQuestion) return { waitingOn: reply.userQuestion }
  return agent(`${prompt}\n\nThe PO answered your question "${result.question}": ${reply.answer}`, {
    agentType: `dark-factory:${role}`, model, phase, label: `${role}:answered`, schema,
  })
}

async function gate(p, role, tier) {
  attempt += 1
  const result = await script(`${S}/gate.mjs ${p.worktree} ${task} ${role} ${attempt} ${MODELS[tier]}`, 'Code', `gate:${attempt}`)
  return { passed: result.exitCode === 0, report: result.stdout }
}

async function untilGreen(p, ladder, instructions) {
  let failure = ''
  for (const [index, step] of ladder.entries()) {
    if (index > 0 && ladder[index - 1].tier !== step.tier) {
      trace.push({ event: 'escalation', from: `${ladder[index - 1].role}:${ladder[index - 1].tier}`, to: `${step.role}:${step.tier}` })
    }
    const extra = failure ? `\n\nThe gate failed after the previous attempt. Fix this first:\n${failure}` : ''
    const outcome = await runRole(p, step.role, `${instructions}${extra}`, { tier: step.tier, phase: 'Code' })
    if (outcome?.waitingOn) return outcome
    const result = await gate(p, step.role, step.tier)
    if (result.passed) return { passed: true }
    failure = result.report
  }
  return { passed: false, failure }
}

async function finish(p, status, message) {
  const encoded = base64Of(utf8ByteString(JSON.stringify(trace.map((event) => ({ ...event, task })))))
  await script(`${S}/task.mjs trace ${task} ${encoded}`, 'Ship', 'trace')
  await script(`${S}/task.mjs status ${task} ${status} ${quoted(message)}`, 'Ship', 'status')
  await script(`${S}/notify.mjs ${task} ${status} ${quoted(message)}`, 'Ship', 'notify')
  return { task, status, message, pr: p?.pr }
}

async function waitFor(p, outcome) {
  if (!outcome?.waitingOn) return null
  await script(`${S}/task.mjs ask ${task} ${quoted(outcome.waitingOn)}`, 'Specify', 'ask-user')
  return finish(p, 'waiting', outcome.waitingOn)
}

const BEFORE = {
  architect: 'Write design.md for this change.',
  planner: 'Write plan.md for this change.',
  debugger: 'Reproduce the bug described in the spec and write repro.md with the root cause.',
  'test-writer': 'Write the failing tests for every acceptance criterion and commit them.',
}

phase('Prepare')
const prepared = await script(`${S}/task.mjs prepare ${task}`, 'Prepare', 'prepare')
const p = parsed(prepared)
if (prepared.exitCode !== 0 || !p) return finish(null, 'stuck', `prepare failed: ${prepared.stdout.slice(-500)}`)

phase('Specify')
for (const role of p.before) {
  const outcome = await runRole(p, role, BEFORE[role], { phase: 'Specify' })
  const waiting = await waitFor(p, outcome)
  if (waiting) return waiting
}

phase('Code')
const source = p.before.includes('planner') ? 'plan.md' : p.before.includes('debugger') ? 'repro.md' : 'the spec'
const coded = await untilGreen(p, CODE_LADDER, `Implement the change described in ${source}.`)
if (coded.waitingOn) return waitFor(p, coded)
if (!coded.passed) return finish(p, 'stuck', `the gate still fails after ${CODE_LADDER.length} attempts:\n${coded.failure.slice(-1500)}`)

phase('Review')
const diffRoles = parsed(await script(`${S}/roles.mjs after ${p.category} ${p.worktree} origin/${p.base}`, 'Review', 'roles'))
const after = diffRoles?.roles ?? ['reviewer', 'tester']
for (const role of diffRoles?.added ?? []) trace.push({ event: 'roles_added', role })
for (let round = 1; round <= REVIEW_ROUNDS; round += 1) {
  const review = await runRole(p, 'reviewer', 'Review the branch diff against its base and the spec.', { phase: 'Review', schema: REVIEW_RESULT })
  const findings = review?.findings ?? []
  trace.push({ event: 'review', round, findings: findings.length })
  if (findings.length === 0) break
  const fixed = await untilGreen(p, FIX_LADDER, `Fix these review findings:\n${JSON.stringify(findings, null, 2)}`)
  if (!fixed.passed) return finish(p, 'stuck', 'review findings could not be fixed with the gate green')
}

if (after.includes('tester')) {
  const tested = await runRole(p, 'tester', 'Test every acceptance criterion in the running app.', { phase: 'Review', schema: TEST_RESULT })
  const unmet = (tested?.criteria ?? []).filter((criterion) => !criterion.met)
  trace.push({ event: 'test', unmet: unmet.length })
  if (unmet.length) {
    const fixed = await untilGreen(p, FIX_LADDER, `The tester found unmet criteria in the running app:\n${JSON.stringify(unmet, null, 2)}`)
    if (!fixed.passed) return finish(p, 'stuck', 'tester findings could not be fixed with the gate green')
  }
}

phase('Ship')
const synced = await script(`${S}/ship.mjs sync ${task}`, 'Ship', 'sync')
if (synced.exitCode !== 0) return finish(p, 'stuck', `rebasing on ${p.base} conflicts; it needs a hand`)
await script(`${S}/ship.mjs push ${task}`, 'Ship', 'push')
const opened = parsed(await script(`${S}/ship.mjs pr ${task}`, 'Ship', 'pr'))
p.pr = opened?.pr

for (let round = 1; round <= CI_ROUNDS; round += 1) {
  let ci = { exitCode: 3 }
  for (let poll = 0; poll < CI_POLLS && ci.exitCode === 3; poll += 1) {
    ci = await script(`${S}/ci-wait.mjs ${task}`, 'Ship', `ci:${round}`)
  }
  if (ci.exitCode === 0 || ci.exitCode === 2) break
  if (round === CI_ROUNDS) return finish(p, 'stuck', `CI still fails after ${CI_ROUNDS} rounds: ${ci.stdout}`)
  const fixed = await untilGreen(p, FIX_LADDER.slice(2), `CI failed on the pull request: ${ci.stdout}. Read the failing logs with gh run view and fix the cause.`)
  if (!fixed.passed) return finish(p, 'stuck', 'CI failures could not be fixed with the gate green')
  await script(`${S}/ship.mjs push ${task}`, 'Ship', 'push')
}

await script(`${S}/ship.mjs ready ${task}`, 'Ship', 'ready')
return finish(p, 'ready', `Ready for your review: ${p.pr}`)
