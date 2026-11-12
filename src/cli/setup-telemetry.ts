import * as clack from "@clack/prompts";
import { raw as readSettings, write as writeSettings } from "../hooks/lib/settings";

const WHAT_IS_SENT =
  "Once a day PAL sends an anonymous heartbeat so we can count how many people use it:\na random install id, the PAL version and channel, your OS and CPU type, and which agents PAL is installed into.\nNothing else, ever. See every send with `pal cli telemetry show`.";

/** True when it showed the notice; only a terminal someone is looking at counts as shown. */
export async function noticeTelemetry(): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  const settings = readSettings();
  if (settings.telemetry?.noticeShown) return false;
  clack.note(WHAT_IS_SENT, "Anonymous usage count");
  clack.log.info("Turn it off any time: pal cli telemetry off");
  writeSettings({ ...settings, telemetry: { ...settings.telemetry, noticeShown: true } });

  return true;
}
