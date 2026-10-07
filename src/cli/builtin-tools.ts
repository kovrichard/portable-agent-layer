/**
 * PAL's own agent tools, surfaced as `pal cli <verb>`.
 *
 * Instruction text names the verb rather than `bun ~/.pal/tools/<tool>.ts`, so
 * no shell has to expand a tilde — which cmd.exe never does and PowerShell
 * passes through literally — and a tool can move without breaking every doc
 * that calls it.
 */

import { command as algorithmReflect } from "../tools/agent/algorithm-reflect";
import { command as algorithmSynthesize } from "../tools/agent/algorithm-synthesize";
import { command as analyze } from "../tools/agent/analyze";
import { command as handoffNote } from "../tools/agent/handoff-note";
import { command as interaction } from "../tools/agent/interaction";
import { command as project } from "../tools/agent/project";
import { command as relationshipNote } from "../tools/agent/relationship-note";
import { command as relationshipReflect } from "../tools/agent/relationship-reflect";
import { command as synthesize } from "../tools/agent/synthesize";
import { command as thread } from "../tools/agent/thread";
import { command as wisdomFrame } from "../tools/agent/wisdom-frame";
import type { Command } from "../tools/lib/command";

export const builtinTools: Record<string, Command> = {
  "algorithm-reflect": algorithmReflect,
  "algorithm-synthesize": algorithmSynthesize,
  analyze,
  "handoff-note": handoffNote,
  interaction,
  project,
  "relationship-note": relationshipNote,
  "relationship-reflect": relationshipReflect,
  synthesize,
  thread,
  "wisdom-frame": wisdomFrame,
};

export const builtinToolVerbs = Object.keys(builtinTools).sort();
