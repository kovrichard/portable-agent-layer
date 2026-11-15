/**
 * Spawned, never awaited — runs the doctor in a process of its own so that
 * cache/health.json is fresh for the statusline without a session waiting on it.
 */

import { runBackgroundDoctor } from "../cli/doctor/run";
import { logError } from "../core/log";
import { recordHookRunOnExit } from "../usage/hook-run";

recordHookRunOnExit();

try {
  runBackgroundDoctor();
} catch (err) {
  logError("HealthCheck", err);
}
