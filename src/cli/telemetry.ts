import { raw as readSettings, write as writeSettings } from "../hooks/lib/settings";
import {
  heartbeatEndpoint,
  optOutReason,
  recentHeartbeats,
  sendHeartbeat,
  telemetryState,
} from "../hooks/lib/telemetry";
import { group, leaf } from "../tools/lib/command";
import { agentsWithPal } from "./doctor/agents";

function setEnabled(enabled: boolean): undefined {
  const settings = readSettings();
  writeSettings({ ...settings, telemetry: { ...settings.telemetry, enabled } });
  console.log(enabled ? "Telemetry on." : "Telemetry off. Nothing will be sent.");
}

async function sendNow(): Promise<undefined> {
  console.log(await sendHeartbeat(agentsWithPal()));
}

function printStatus(): undefined {
  const reason = optOutReason();
  const state = telemetryState();
  const onOrOff = reason ? `off (${reason})` : "on";
  console.log(`telemetry    ${onOrOff}`);
  console.log(`install id   ${state.id}`);
  console.log(`endpoint     ${heartbeatEndpoint() ?? "none configured"}`);
  console.log(`last attempt ${state.attemptedAt ?? "never"}`);
}

function printSent(): undefined {
  const events = recentHeartbeats();
  if (events.length === 0) {
    console.log("Nothing sent or skipped in the last 30 days.");
    return;
  }
  for (const event of events) {
    const detail = event.payload ?? { skipReason: event.skipReason };
    console.log(`${event.ts}  ${event.outcome}  ${JSON.stringify(detail)}`);
  }
}

export const telemetryCommand = group({
  summary: "The daily anonymous heartbeat that counts PAL installs",
  commands: {
    status: leaf({ summary: "Whether it is on, and the id it sends", run: printStatus }),
    show: leaf({
      summary: "Every heartbeat of the last 30 days, exactly as sent",
      run: printSent,
    }),
    on: leaf({ summary: "Send the daily heartbeat", run: () => setEnabled(true) }),
    off: leaf({ summary: "Never send the heartbeat", run: () => setEnabled(false) }),
    send: leaf({
      summary: "Send today's heartbeat now (PAL runs this itself once a day)",
      run: sendNow,
    }),
  },
});
