import { refreshCachesOnStart } from "../../context/start-refresh";
import { startSyncIfDue } from "./sync-trigger";
import { heartbeatOnStart } from "./telemetry";

/** What session start sets off; none of it holds the session up. */
export function startBackgroundWork(): void {
  heartbeatOnStart();
  refreshCachesOnStart();
  startSyncIfDue("start");
}
