/**
 * pal cli judge: one judgment for programs outside PAL. The request is JSON from a file or stdin; routing, fallback and logging all live in judge().
 */

import { judge } from "../hooks/lib/judge";
import { judgeRequestJson } from "../hooks/lib/judgment";
import { toPath } from "../hooks/lib/paths";
import { leaf } from "../tools/lib/command";

async function readRequestText(path: string | undefined): Promise<string> {
  return path ? await Bun.file(toPath(path)).text() : await Bun.stdin.text();
}

async function judgeFromCli(path: string | undefined): Promise<number> {
  let text: string;

  try {
    text = await readRequestText(path);
  } catch {
    console.error(`Cannot read ${path}`);

    return 1;
  }

  if (!text.trim()) {
    console.error("No request: pass a JSON file or pipe it on stdin.");

    return 1;
  }

  let raw: unknown;

  try {
    raw = JSON.parse(text);
  } catch {
    console.error("The request is not valid JSON.");

    return 1;
  }

  const checked = judgeRequestJson.safeParse(raw);
  if (!checked.success) {
    const problems = checked.error.issues
      .map((issue) => `${issue.path.join(".") || "request"}: ${issue.message}`)
      .join("; ");
    console.error(`Invalid judge request: ${problems}`);

    return 1;
  }

  const result = await judge(checked.data);
  console.log(JSON.stringify(result));

  return result.success ? 0 : 1;
}

export const judgeCommand = leaf({
  summary:
    "Answer typed questions with the System One model or the small tier; JSON request from a file or stdin",
  args: "[file]",
  run: ({ positionals }) => judgeFromCli(positionals[0]),
});
