/**
 * Writes one prompt per case: the shipped SKILL.md body, the fixture, and the
 * output of the skill's own pareto tool on that fixture. The provider has no
 * tools, so the commands the skill would run are run here instead.
 */
import { mkdir } from "node:fs/promises";
import {
  parseArgs,
  parseRows,
  report,
} from "../../assets/skills/pareto-analyze/tools/pareto";

interface Case {
  fixture: string;
  flags: string[];
  request: string;
}

const CASES: Case[] = [
  {
    fixture: "test-timings",
    flags: [
      "--unit",
      "file",
      "--value",
      "seconds",
      "--group-by",
      "spawns",
      "--group-by",
      "directory",
      "--group-by",
      "size",
      "--limit",
      "8",
    ],
    request:
      "Our test suite takes about 100 seconds, which is too slow. I timed every test file in one full run. For every file I also checked whether it starts a subprocess (a search for spawn calls), which directory it is in, and its size band. Where should we focus?",
  },
  {
    fixture: "client-revenue",
    flags: [
      "--unit",
      "client",
      "--value",
      "revenue",
      "--group-by",
      "channel",
      "--group-by",
      "size",
      "--group-by",
      "region",
      "--limit",
      "5",
    ],
    request:
      "This is last year's invoiced revenue per client from our invoicing export, with the channel each client came through, their size band and their region, all taken from the CRM fields. Where does our revenue come from, and where should the sales effort go?",
  },
  {
    fixture: "food-log",
    flags: ["--unit", "item", "--value", "kcal"],
    request:
      "My target is 2,000 kcal a day. My planned meals add up to exactly that, and this is everything I ate or drank outside the plan last week, from my food log. I ended the week 3,580 kcal over target. What should I change?",
  },
];

const here = (path: string) => new URL(path, import.meta.url).pathname;

async function skillBody(): Promise<string> {
  const skill = await Bun.file(
    here("../../assets/skills/pareto-analyze/SKILL.md")
  ).text();
  return skill
    .replace(/^---[\s\S]*?---\n/, "")
    .trim()
    .replace("$ARGUMENTS", "the user's request below");
}

async function promptFor({ fixture, flags, request }: Case): Promise<string> {
  const file = `${fixture}.csv`;
  const csv = await Bun.file(here(`fixtures/${file}`)).text();
  const toolOutput = report(parseRows(file, csv), parseArgs([file, ...flags]));
  return `You are an AI assistant following the skill below for the user's request.

<skill>
${await skillBody()}
</skill>

<user_request>
${request}
</user_request>

<file name="${file}">
${csv.trim()}
</file>

This run has no tools. The framing is settled by the request, so ask no question. The reference files are not available: follow the workflow as written. The command the skill tells you to run was already run on the file, and this is its output:

<tool_output command="pal cli skill run pareto-analyze pareto ${file} ${flags.join(" ")}">
${toolOutput}
</tool_output>

Write the report the skill's output format specifies, and nothing else.
`;
}

await mkdir(here("generated/"), { recursive: true });
for (const testCase of CASES) {
  await Bun.write(here(`generated/${testCase.fixture}.txt`), await promptFor(testCase));
}
