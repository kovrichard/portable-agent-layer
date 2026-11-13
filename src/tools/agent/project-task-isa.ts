import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { paths } from "../../hooks/lib/paths";
import { leaf } from "../lib/command";
import { taskSlug } from "../lib/project-isc";
import { fail, joined, nonBlank, ok } from "./project-io";

function taskIsaPath(slug: string): string {
  const dir = resolve(paths.work(), slug);
  mkdirSync(dir, { recursive: true });

  return resolve(dir, "ISA.md");
}

function cmdScaffoldTaskIsa(text: string): undefined {
  const title = nonBlank(text, "<title...>");
  const slug = taskSlug(title);
  const ts = new Date().toISOString();
  const content = [
    "---",
    `task: "${title}"`,
    `slug: "${slug}"`,
    "phase: active",
    `started: "${ts}"`,
    `updated: "${ts}"`,
    "---",
    "",
    "## Goal",
    "",
    "",
    "## Criteria",
    "",
    "",
  ].join("\n");
  const filePath = taskIsaPath(slug);
  writeFileSync(filePath, content, "utf-8");
  ok({ created: true, slug, path: filePath });
}

function cmdCompleteTaskIsa(slug: string): undefined {
  const filePath = resolve(paths.work(), slug, "ISA.md");
  if (!existsSync(filePath)) fail(`Task ISA not found: ${slug}`);
  const content = readFileSync(filePath, "utf-8");
  const updated = content
    .replace(/^phase: .+$/m, "phase: complete")
    .replace(/^updated: .+$/m, `updated: "${new Date().toISOString()}"`);
  writeFileSync(filePath, updated, "utf-8");
  ok({ completed: true, slug });
}

export const taskIsaCommands = {
  "scaffold-task-isa": leaf({
    summary: "Create a one-shot task ISA in memory/work/",
    args: "<title...>",
    run: ({ positionals }) => cmdScaffoldTaskIsa(joined(positionals)),
  }),
  "complete-task-isa": leaf({
    summary: "Mark a task ISA as complete",
    args: "<slug>",
    run: ({ positionals }) => cmdCompleteTaskIsa(positionals[0]),
  }),
};
