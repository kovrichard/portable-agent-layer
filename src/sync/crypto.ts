/**
 * End-to-end encryption for hosted memory, on WebCrypto alone. The server only
 * ever holds sealed blobs under opaque names, wrapped data keys and signed
 * manifests; every key stays on the user's machines.
 */

const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const encoder = new TextEncoder();

export type SyncCryptoFailure = "tampered" | "bad-signature" | "rollback";

export class SyncCryptoError extends Error {
  constructor(readonly failure: SyncCryptoFailure) {
    super(`sync crypto: ${failure}`);
  }
}

export function randomKey(): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(KEY_BYTES));
}

type Purpose = "wrap" | "file-id" | "manifest";

async function subkeyBits(accountKey: Uint8Array<ArrayBuffer>, purpose: Purpose) {
  const base = await crypto.subtle.importKey("raw", accountKey, "HKDF", false, [
    "deriveBits",
  ]);

  return crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(0),
      info: encoder.encode(`pal-sync/${purpose}`),
    },
    base,
    KEY_BYTES * 8
  );
}

async function hmacKey(accountKey: Uint8Array<ArrayBuffer>, purpose: Purpose) {
  return crypto.subtle.importKey(
    "raw",
    await subkeyBits(accountKey, purpose),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

async function aesKey(raw: BufferSource) {
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

const hex = (bytes: ArrayBuffer) => Buffer.from(bytes).toString("hex");

/** An object name that says nothing about the path it stands for. */
export async function fileId(
  accountKey: Uint8Array<ArrayBuffer>,
  logicalPath: string
): Promise<string> {
  const key = await hmacKey(accountKey, "file-id");

  return hex(await crypto.subtle.sign("HMAC", key, encoder.encode(logicalPath)));
}

async function seal(key: CryptoKey, plaintext: Uint8Array<ArrayBuffer>, aad: string) {
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  const sealed = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce, additionalData: encoder.encode(aad) },
    key,
    plaintext
  );
  const blob = new Uint8Array(NONCE_BYTES + sealed.byteLength);
  blob.set(nonce);
  blob.set(new Uint8Array(sealed), NONCE_BYTES);

  return blob;
}

async function open(key: CryptoKey, blob: Uint8Array<ArrayBuffer>, aad: string) {
  try {
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: blob.subarray(0, NONCE_BYTES),
        additionalData: encoder.encode(aad),
      },
      key,
      blob.subarray(NONCE_BYTES)
    );

    return new Uint8Array(plaintext);
  } catch {
    throw new SyncCryptoError("tampered");
  }
}

/** A file's data key, sealed by the account key and bound to that file. */
export async function wrapDataKey(
  accountKey: Uint8Array<ArrayBuffer>,
  dataKey: Uint8Array<ArrayBuffer>,
  id: string
): Promise<Uint8Array<ArrayBuffer>> {
  return seal(await aesKey(await subkeyBits(accountKey, "wrap")), dataKey, `wrap:${id}`);
}

export async function unwrapDataKey(
  accountKey: Uint8Array<ArrayBuffer>,
  wrapped: Uint8Array<ArrayBuffer>,
  id: string
): Promise<Uint8Array<ArrayBuffer>> {
  return open(await aesKey(await subkeyBits(accountKey, "wrap")), wrapped, `wrap:${id}`);
}

/** Where a blob belongs: the server cannot move it to another file, machine or position. */
export interface BlobPlace {
  fileId: string;
  machine: string;
  seq: number;
}

const placeAad = (place: BlobPlace) =>
  JSON.stringify([place.fileId, place.machine, place.seq]);

export async function sealBlob(
  dataKey: Uint8Array<ArrayBuffer>,
  plaintext: Uint8Array<ArrayBuffer>,
  place: BlobPlace
): Promise<Uint8Array<ArrayBuffer>> {
  return seal(await aesKey(dataKey), plaintext, placeAad(place));
}

export async function openBlob(
  dataKey: Uint8Array<ArrayBuffer>,
  blob: Uint8Array<ArrayBuffer>,
  place: BlobPlace
): Promise<Uint8Array<ArrayBuffer>> {
  return open(await aesKey(dataKey), blob, placeAad(place));
}

/** What one machine has uploaded: its last seq per file, under a counter that only grows. */
export interface Manifest {
  machine: string;
  counter: number;
  files: Record<string, number>;
}

export interface SignedManifest {
  manifest: Manifest;
  mac: string;
}

const canonical = (manifest: Manifest) =>
  JSON.stringify([
    manifest.machine,
    manifest.counter,
    Object.entries(manifest.files).sort(([a], [b]) => a.localeCompare(b)),
  ]);

export async function signManifest(
  accountKey: Uint8Array<ArrayBuffer>,
  manifest: Manifest
): Promise<SignedManifest> {
  const key = await hmacKey(accountKey, "manifest");
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(canonical(manifest)));

  return { manifest, mac: hex(mac) };
}

/** The manifest, once its signature holds and its counter has not gone back below the last one seen. */
export async function verifyManifest(
  accountKey: Uint8Array<ArrayBuffer>,
  signed: SignedManifest,
  lastSeenCounter = 0
): Promise<Manifest> {
  const key = await hmacKey(accountKey, "manifest");
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    Buffer.from(signed.mac, "hex"),
    encoder.encode(canonical(signed.manifest))
  );
  if (!valid) throw new SyncCryptoError("bad-signature");

  if (signed.manifest.counter < lastSeenCounter) throw new SyncCryptoError("rollback");

  return signed.manifest;
}
