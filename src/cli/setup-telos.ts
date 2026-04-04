/**
 * Interactive TELOS setup — prompts for personal context during `pal install`.
 * Skips any step whose TELOS file already has real content.
 * Projects use the upsertProject tool directly with a structured add-another loop.
 */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import * as clack from "@clack/prompts";
import { upsertProject } from "../../assets/skills/telos/tools/update-projects";
import { palHome } from "../hooks/lib/paths";
import { hasRealContent, SETUP_STEPS, STEP_ORDER } from "../hooks/lib/setup";

function toKebabCase(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

async function promptProjectsLoop(): Promise<void> {
  const addFirst = await clack.confirm({
    message: "Do you want to add any projects now?",
    initialValue: true,
  });
  if (clack.isCancel(addFirst) || !addFirst) return;

  let addMore = true;
  while (addMore) {
    const name = await clack.text({
      message: "Project name?",
      placeholder: "e.g. PAL, My SaaS, Work Dashboard",
    });
    if (clack.isCancel(name)) return;

    const status = await clack.select({
      message: "Status?",
      options: [
        { value: "Active", label: "Active" },
        { value: "Planning", label: "Planning" },
        { value: "Paused", label: "Paused" },
        { value: "Complete", label: "Complete" },
      ],
    });
    if (clack.isCancel(status)) return;

    const priority = await clack.select({
      message: "Priority?",
      options: [
        { value: "High", label: "High" },
        { value: "Medium", label: "Medium" },
        { value: "Low", label: "Low" },
      ],
    });
    if (clack.isCancel(priority)) return;

    const notes = await clack.text({
      message: "Notes? (optional — leave blank to skip)",
      placeholder: "e.g. Building the v2 API, blocked on design review",
    });
    if (clack.isCancel(notes)) return;

    const id = toKebabCase(name as string);
    const row = `| ${id} | ${name} | ${status} | ${priority} | ${notes || ""} |`;
    upsertProject(id, row, `Added ${name} during PAL setup`);
    clack.log.success(`Added: ${name}`);

    const again = await clack.confirm({
      message: "Add another project?",
      initialValue: false,
    });
    if (clack.isCancel(again) || !again) addMore = false;
  }
}

/** Prompt for missing TELOS context. Skips any step whose file already has real content. */
export async function promptTelos(): Promise<void> {
  // Skip interactive prompts in non-TTY environments (tests, CI)
  if (!process.stdin.isTTY) return;

  const home = palHome();
  const pending = STEP_ORDER.filter(
    (key) => !hasRealContent(resolve(home, SETUP_STEPS[key].file))
  );

  if (pending.length === 0) {
    clack.log.info("TELOS already configured");
    return;
  }

  clack.intro("Personal Context Setup");
  clack.note(
    "Answer in a sentence or two — you can edit the files in ~/.pal/telos/ for more detail later.",
    "Quick setup"
  );

  for (const key of pending) {
    if (key === "projects") {
      await promptProjectsLoop();
    } else {
      const step = SETUP_STEPS[key];
      const title = key.charAt(0).toUpperCase() + key.slice(1);

      const answer = await clack.text({
        message: step.question,
        placeholder: step.hint,
      });

      if (clack.isCancel(answer)) {
        clack.cancel("Setup cancelled");
        return;
      }

      const filePath = resolve(home, step.file);
      writeFileSync(filePath, `# ${title}\n\n${answer}\n`, "utf-8");
    }
  }

  clack.outro("Personal context saved ✓");
}
