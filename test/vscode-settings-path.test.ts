import { afterEach, describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { vscodeSettingsFile } from "../src/targets/lib";

const realPlatform = process.platform;
const savedXdg = process.env.XDG_CONFIG_HOME;
const savedAppData = process.env.APPDATA;

function asPlatform(value: string) {
  Object.defineProperty(process, "platform", { value, configurable: true });
}

afterEach(() => {
  Object.defineProperty(process, "platform", {
    value: realPlatform,
    configurable: true,
  });
  if (savedXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = savedXdg;
  if (savedAppData === undefined) delete process.env.APPDATA;
  else process.env.APPDATA = savedAppData;
});

describe("vscodeSettingsFile", () => {
  test("resolves under Application Support on macOS", () => {
    asPlatform("darwin");

    expect(vscodeSettingsFile()).toBe(
      resolve(
        homedir(),
        "Library",
        "Application Support",
        "Code",
        "User",
        "settings.json"
      )
    );
  });

  test("honours XDG_CONFIG_HOME on Linux", () => {
    asPlatform("linux");
    process.env.XDG_CONFIG_HOME = "/xdg";

    expect(vscodeSettingsFile()).toBe(resolve("/xdg", "Code", "User", "settings.json"));
  });

  test("falls back to ~/.config on Linux", () => {
    asPlatform("linux");
    delete process.env.XDG_CONFIG_HOME;

    expect(vscodeSettingsFile()).toBe(
      resolve(homedir(), ".config", "Code", "User", "settings.json")
    );
  });

  test("honours APPDATA on Windows", () => {
    asPlatform("win32");
    process.env.APPDATA = "/appdata";

    expect(vscodeSettingsFile()).toBe(
      resolve("/appdata", "Code", "User", "settings.json")
    );
  });

  test("falls back to AppData/Roaming on Windows", () => {
    asPlatform("win32");
    delete process.env.APPDATA;

    expect(vscodeSettingsFile()).toBe(
      resolve(homedir(), "AppData", "Roaming", "Code", "User", "settings.json")
    );
  });

  test("returns null on an unsupported platform", () => {
    asPlatform("freebsd");

    expect(vscodeSettingsFile()).toBeNull();
  });
});
