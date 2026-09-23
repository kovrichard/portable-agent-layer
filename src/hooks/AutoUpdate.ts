/**
 * Spawned, never awaited — runs the daily self-update in a process of its own.
 *
 * LoadContext decides whether today's update is due; the control room's button
 * starts this directly. Either way the work happens here so nothing waits on a
 * git pull and a reinstall.
 */

import { runAutoUpdate } from "./lib/auto-update";
import { logError } from "./lib/log";

try {
  runAutoUpdate();
} catch (err) {
  logError("AutoUpdate", err);
}
