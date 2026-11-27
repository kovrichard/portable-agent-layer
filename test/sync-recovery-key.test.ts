import { describe, expect, test } from "bun:test";
import { randomKey } from "../src/sync/crypto";
import {
  formatRecoveryKey,
  parseRecoveryKey,
  RecoveryKeyError,
} from "../src/sync/recovery-key";

const swapChar = (text: string, at: number) => {
  const char = text.charAt(at);
  const other = char === "7" ? "8" : "7";

  return text.slice(0, at) + other + text.slice(at + 1);
};

describe("recovery key", () => {
  test("is 14 groups of four characters and reads back to the same key", () => {
    for (let i = 0; i < 50; i++) {
      const key = randomKey();
      const text = formatRecoveryKey(key);

      expect(text).toMatch(/^([0-9A-HJKMNP-TV-Z]{4}-){13}[0-9A-HJKMNP-TV-Z]{4}$/);
      expect(parseRecoveryKey(text)).toEqual(key);
    }
  });

  test("forgives case, spaces, missing dashes and look-alike letters", () => {
    const key = new Uint8Array(32).fill(0);
    const text = formatRecoveryKey(key);
    const sloppy = text.toLowerCase().replaceAll("-", " ").replaceAll("0", "o");

    expect(parseRecoveryKey(sloppy)).toEqual(key);
  });

  test("a changed character fails the checksum instead of giving another key", () => {
    const text = formatRecoveryKey(randomKey());

    for (const at of [0, 20, 64, 68])
      expect(() => parseRecoveryKey(swapChar(text, at))).toThrow(RecoveryKeyError);
  });

  test("says what is wrong with a key of the wrong length or a stray character", () => {
    const text = formatRecoveryKey(randomKey());

    expect(() => parseRecoveryKey(text.slice(0, -1))).toThrow(
      "a recovery key has 56 characters, this has 55"
    );
    expect(() => parseRecoveryKey(`${text.slice(0, -1)}U`)).toThrow('"U"');
  });

  test("reads I and L as 1", () => {
    const key = new Uint8Array(32).fill(0x08);
    const text = formatRecoveryKey(key);

    expect(text).toContain("1");
    expect(parseRecoveryKey(text.replaceAll("1", "l"))).toEqual(key);
    expect(parseRecoveryKey(text.replaceAll("1", "I"))).toEqual(key);
  });

  test("a change in the padding bits is a typo, though the key and checksum still match", () => {
    const chars = formatRecoveryKey(randomKey()).replaceAll("-", "");
    const lastKeyChar = chars.charAt(51);
    const padded = String.fromCharCode(lastKeyChar.charCodeAt(0) + 1);

    expect(() => parseRecoveryKey(chars.slice(0, 51) + padded + chars.slice(52))).toThrow(
      "typo"
    );
  });
});
