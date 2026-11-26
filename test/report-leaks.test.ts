import { describe, expect, test } from "bun:test";
import { findLeaks, type Identifiers, withHomeAsTilde } from "../src/report/leaks";

const IDS: Identifiers = {
  home: "/home/ada",
  words: [
    { kind: "user-name", value: "ada" },
    { kind: "host-name", value: "ada-desktop" },
    { kind: "project", value: "acme-billing" },
    { kind: "remote", value: "github.com/acme/billing" },
    { kind: "person-or-company", value: "Grace Hopper" },
  ],
};

const kindsIn = (text: string) => findLeaks(text, IDS).map((leak) => leak.kind);

describe("the leak check", () => {
  test.each([
    ["the home path", "read /home/ada/.pal/settings.json", "home-path"],
    ["the user name", "Ada saw it first", "user-name"],
    ["the host name", "on ada-desktop it fails", "host-name"],
    ["a project name", "in acme-billing the hook crashed", "project"],
    ["a project remote", "cloned from github.com/acme/billing", "remote"],
    ["a known person", "Grace Hopper reported it", "person-or-company"],
    ["an email address", "mail me at someone@corp.io", "email"],
    ["a GitHub token", "token ghp_abcdefghijklmnopqrstuvwxyz123456", "secret"],
    ["a private key", "-----BEGIN OPENSSH PRIVATE KEY-----", "secret"],
  ])("blocks %s", (_, line, kind) => {
    expect(kindsIn(line)).toContain(kind);
  });

  test("passes a report written in PAL's own terms", () => {
    const report = [
      "The doctor's health check fails after `pal cli update`.",
      "Reproduce on a fresh PAL_HOME: run `pal cli migrate`, then open a session in a repository.",
      "Contact: someone@example.com",
    ].join("\n");

    expect(findLeaks(report, IDS)).toEqual([]);
  });

  test("matches whole words only, so a name inside another word passes", () => {
    expect(kindsIn("the adapter reads the cadastre")).toEqual([]);
  });

  test("names the line and reports one hit once", () => {
    expect(findLeaks("fine\nada and ADA again", IDS)).toEqual([
      { line: 2, kind: "user-name", found: "ada" },
    ]);
  });

  test("never prints a found token back", () => {
    expect(findLeaks("ghp_abcdefghijklmnopqrstuvwxyz123456", IDS)[0].found).toBe(
      "a token"
    );
  });

  test("rewrites the home path to ~", () => {
    expect(withHomeAsTilde("at /home/ada/x and /home/ada/y", "/home/ada")).toBe(
      "at ~/x and ~/y"
    );
  });
});
