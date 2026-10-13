import { allEventsSince } from "../hooks/lib/events";
import { localDay } from "../hooks/lib/wall-clock";
import { leaf } from "../tools/lib/command";
import { projectActivity } from "../tools/lib/patterns/activity";
import { contextSwitches, dayShape } from "../tools/lib/patterns/days";
import { focusBlocks } from "../tools/lib/patterns/focus";
import { daysLines, focusLines, momentumLines } from "../tools/lib/patterns/render";
import { currentSprint, quietAfterBurst } from "../tools/lib/patterns/sprint";

function printPatterns(): undefined {
  const activity = projectActivity(allEventsSince(new Date(0)));
  console.log("\n  PAL Patterns");
  const lines = [
    ...momentumLines(currentSprint(activity), quietAfterBurst(activity, localDay())),
    ...daysLines(dayShape(activity), contextSwitches(activity)),
    ...focusLines(focusBlocks(activity)),
  ];
  for (const line of lines) console.log(line);
}

export const patternsCommand = leaf({
  summary: "How you work across projects, read from the event log",
  run: () => printPatterns(),
});
