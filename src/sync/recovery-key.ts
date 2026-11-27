/**
 * The account key as a person writes it down: 52 Crockford base32 characters
 * for the 256-bit key and 4 more for a checksum, in groups of four. Reading it
 * back forgives case, spaces, dashes and the letters people confuse with digits,
 * and a typo fails the checksum instead of yielding a wrong key.
 */

import { createHash } from "node:crypto";

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const KEY_BYTES = 32;
const KEY_CHARS = 52;
const CHECK_CHARS = 4;
const PAD_BITS = BigInt(KEY_CHARS * 5 - KEY_BYTES * 8);
const LOOKALIKES: Record<string, string> = { O: "0", I: "1", L: "1" };

export class RecoveryKeyError extends Error {}

const bigOfBytes = (bytes: Uint8Array) =>
  bytes.reduce((value, byte) => (value << 8n) | BigInt(byte), 0n);

function bytesOfBig(value: bigint, length: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(length);
  let rest = value;

  for (let i = length - 1; i >= 0; i--) {
    bytes[i] = Number(rest & 255n);
    rest >>= 8n;
  }

  return bytes;
}

function charsOfBig(value: bigint, length: number): string {
  return Array.from({ length }, (_, i) =>
    ALPHABET.charAt(Number((value >> BigInt(5 * (length - 1 - i))) & 31n))
  ).join("");
}

const bigOfChars = (chars: string) =>
  [...chars].reduce((value, char) => value * 32n + BigInt(ALPHABET.indexOf(char)), 0n);

function checksum(key: Uint8Array): string {
  const digest = createHash("sha256").update(key).digest();

  return charsOfBig(bigOfBytes(digest.subarray(0, 3)) >> 4n, CHECK_CHARS);
}

export function formatRecoveryKey(key: Uint8Array): string {
  const chars = charsOfBig(bigOfBytes(key) << PAD_BITS, KEY_CHARS) + checksum(key);

  return chars.match(/.{4}/g)?.join("-") ?? chars;
}

function normalized(text: string): string {
  const chars = [...text.toUpperCase().replace(/[\s-]/g, "")].map(
    (char) => LOOKALIKES[char] ?? char
  );
  const stray = chars.find((char) => !ALPHABET.includes(char));
  if (stray) throw new RecoveryKeyError(`"${stray}" is not in a recovery key`);

  return chars.join("");
}

export function parseRecoveryKey(text: string): Uint8Array<ArrayBuffer> {
  const chars = normalized(text);
  if (chars.length !== KEY_CHARS + CHECK_CHARS)
    throw new RecoveryKeyError(
      `a recovery key has ${KEY_CHARS + CHECK_CHARS} characters, this has ${chars.length}`
    );

  const value = bigOfChars(chars.slice(0, KEY_CHARS));
  const key = bytesOfBig(value >> PAD_BITS, KEY_BYTES);
  const padded = (value & ((1n << PAD_BITS) - 1n)) === 0n;
  if (!padded || checksum(key) !== chars.slice(KEY_CHARS))
    throw new RecoveryKeyError(
      "the recovery key has a typo: its checksum does not match"
    );

  return key;
}
