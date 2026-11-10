/**
 * Spawned, never awaited — runs the unattended self-update in a process of its own.
 *
 * LoadContext decides whether today's update is due; the control room's button
 * starts this directly. Either way the work happens here so nothing waits on a
 * git pull and a reinstall.
 */

import { runAutoUpdate } from "./lib/auto-update";
import { recordHookRunOnExit } from "./lib/hook-run";
import { logError } from "./lib/log";

recordHookRunOnExit();

try {
  runAutoUpdate();
} catch (err) {
  logError("AutoUpdate", err);
}
