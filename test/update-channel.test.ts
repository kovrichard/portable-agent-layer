import { beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { createStyle } from "../src/cli/ui/style";
import type { Terminal } from "../src/cli/ui/terminal";
import { channelSwitchLine, requestedChannel } from "../src/cli/update-flow";
import {
  checkPackage,
  setUpdateChannel,
  type UpdateCache,
  updateChannel,
} from "../src/hooks/handlers/update-check";
import { reload, write } from "../src/hooks/lib/settings";
import { freshTestDir } from "./lib/test-home";

const pipe: Terminal = { rich: false, color: "none", unicode: true, width: 80 };
const plain = createStyle(pipe);

beforeEach(() => {
  const home = freshTestDir(import.meta.file);
  process.env.PAL_HOME = home;
  mkdirSync(resolve(home, "memory"), { recursive: true });
  reload();
});

function registry(version: string) {
  const asked: string[] = [];
  const fetchImpl = (async (url: string) => {
    asked.push(url);
    return Response.json({ version });
  }) as unknown as typeof fetch;
  return { asked, fetchImpl };
}

describe("the update channel", () => {
  test("is stable until a switch is recorded", () => {
    expect(updateChannel()).toBe("stable");
  });

  test("stays canary once switched, across a fresh read", () => {
    setUpdateChannel("canary");
    reload();
    expect(updateChannel()).toBe("canary");
  });

  test("an unknown stored value reads as stable", () => {
    write(JSON.parse('{ "updateChannel": "nightly" }'));
    reload();
    expect(updateChannel()).toBe("stable");
  });

  test("the package check asks npm for the canary tag on the canary channel", async () => {
    setUpdateChannel("canary");
    const { asked, fetchImpl } = registry("999.0.0-canary.1");
    const update = await checkPackage(updateChannel(), fetchImpl);
    expect(asked).toEqual(["https://registry.npmjs.org/portable-agent-layer/canary"]);
    expect(update.available).toBe(true);
  });

  test("the package check asks npm for latest on the stable channel", async () => {
    const { asked, fetchImpl } = registry("0.0.1");
    await checkPackage(updateChannel(), fetchImpl);
    expect(asked).toEqual(["https://registry.npmjs.org/portable-agent-layer/latest"]);
  });
});

describe("which channel an update runs on", () => {
  test("a plain update follows the stored channel", () => {
    expect(requestedChannel({}, "canary")).toBe("canary");
    expect(requestedChannel({}, "stable")).toBe("stable");
  });

  test("--canary and --stable choose the channel", () => {
    expect(requestedChannel({ canary: true }, "stable")).toBe("canary");
    expect(requestedChannel({ stable: true }, "canary")).toBe("stable");
  });

  test("both flags at once is refused", () => {
    expect(requestedChannel({ canary: true, stable: true }, "stable")).toBeNull();
  });
});

const checked = (current: string, latest: string, available: boolean): UpdateCache => ({
  checkedAt: "",
  available,
  current,
  latest,
  mode: "package",
});

describe("the switch warning", () => {
  test("says nothing when the channel stays the same", () => {
    expect(
      channelSwitchLine(plain, "canary", "canary", checked("1.0.0", "1.0.0", false))
    ).toBeNull();
  });

  test("switching to canary", () => {
    expect(
      channelSwitchLine(
        plain,
        "stable",
        "canary",
        checked("0.113.0", "0.114.0-canary.22", true)
      )
    ).toBe(
      "warn Switched to the canary channel: plain updates and auto-update now install prereleases -> pal cli update --stable to go back"
    );
  });

  test("switching to stable", () => {
    expect(
      channelSwitchLine(
        plain,
        "canary",
        "stable",
        checked("0.114.0-canary.22", "0.114.0", true)
      )
    ).toBe(
      "warn Switched to the stable channel: plain updates and auto-update now install stable releases only -> pal cli update --canary to go back"
    );
  });

  test("switching to stable while stable is older keeps the install", () => {
    expect(
      channelSwitchLine(
        plain,
        "canary",
        "stable",
        checked("0.114.0-canary.22", "0.113.0", false)
      )
    ).toBe(
      "warn Switched to the stable channel, but stable 0.113.0 is older than 0.114.0-canary.22 — staying on this version until a stable release catches up -> pal cli update --canary to go back"
    );
  });
});
