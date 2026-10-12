import { describe, expect, test } from "bun:test";
import {
  imageCount,
  languageOf,
  pastedChars,
  responseModeOf,
  slashCommandOf,
} from "../src/hooks/lib/turn-extras";

describe("languageOf", () => {
  test("names English and Hungarian by their common words", () => {
    expect(languageOf("what is the state of the build")).toBe("en");
    expect(languageOf("szerintem ez nem jó, de meg kell nézni hogy van-e más")).toBe(
      "hu"
    );
  });

  test("stays silent when too few common words say which", () => {
    expect(languageOf("push it")).toBeNull();
    expect(languageOf("")).toBeNull();
  });
});

describe("pastedChars", () => {
  test("counts the characters inside every pasted block", () => {
    const prompt =
      'look <pasted_content id="a">12345</pasted_content id="a"> and <pasted_content id="b">678</pasted_content id="b">';
    expect(pastedChars(prompt)).toBe(8);
  });

  test("is zero without a paste", () => {
    expect(pastedChars("plain prompt")).toBe(0);
  });
});

describe("imageCount", () => {
  test("counts image markers", () => {
    expect(imageCount("compare [Image #1] with [Image #2]")).toBe(2);
    expect(imageCount("no images")).toBe(0);
  });
});

describe("slashCommandOf", () => {
  test("reads a typed slash command or the command tag the agent wraps it in", () => {
    expect(slashCommandOf("/loop 5m check ci")).toBe("loop");
    expect(slashCommandOf("<command-name>/code-review</command-name> args")).toBe(
      "code-review"
    );
  });

  test("a path in the middle of a prompt is not a command", () => {
    expect(slashCommandOf("read /etc/hosts please")).toBeNull();
  });
});

describe("responseModeOf", () => {
  test("reads the mode from the reply header", () => {
    expect(responseModeOf("══════ PAL | ALGORITHM ══════\n🗒️ TASK")).toBe("ALGORITHM");
    expect(responseModeOf("══════ PAL | NATIVE ══════\nx")).toBe("NATIVE");
    expect(responseModeOf("══════ PAL ══════\n🗣️ hi")).toBe("MINIMAL");
  });

  test("a reply without a header has no mode", () => {
    expect(responseModeOf("Just text.")).toBeNull();
  });
});
