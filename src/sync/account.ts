/**
 * This machine's sync account: which store it syncs through and the account
 * key, both in the install's own sync folder, which never leaves the machine.
 * The store holds one `account/check` blob, a random key wrapped by the account
 * key, so a second setup is refused and a wrong recovery key is caught before
 * anything syncs.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { appendEvent } from "../bronze/events";
import { AwsCredentialsError, awsCredentials } from "./aws-credentials";
import { type BlobStore, directoryStore } from "./blob-store";
import { randomKey, unwrapDataKey, wrapDataKey } from "./crypto";
import { s3Store } from "./s3-store";
import { syncStateDir } from "./state";

/** Names where the credentials live, never the credentials themselves. */
export type StoreConfig =
  | { kind: "dir"; path: string }
  | { kind: "s3"; bucket: string; prefix: string; profile?: string; endpoint?: string };

const S3_SETTINGS = ["profile", "endpoint"] as const;

export interface SyncAccount {
  store: StoreConfig;
  key: Uint8Array<ArrayBuffer>;
}

export class AccountError extends Error {}

const CHECK_NAME = "account/check";
const CHECK_ID = "account";

export const accountKeyFile = (home: string) =>
  resolve(syncStateDir(home), "account.key");
const accountFile = (home: string) => resolve(syncStateDir(home), "account.json");

function s3ConfigOf(where: string): StoreConfig {
  const url = new URL(where);
  if (!url.hostname)
    throw new AccountError("name the bucket: s3://<bucket>/<prefix>?profile=<name>");
  const settings = S3_SETTINGS.flatMap((name) => {
    const value = url.searchParams.get(name);

    return value ? [[name, value]] : [];
  });

  return {
    kind: "s3",
    bucket: url.hostname,
    prefix: decodeURIComponent(url.pathname).replace(/^\/+|\/+$/g, ""),
    ...Object.fromEntries(settings),
  };
}

/**
 * Where the store is, as a person types it: a folder path or `file://` URL for
 * a folder this machine can reach (a NAS mount, a synced folder), or
 * `s3://<bucket>/<prefix>?profile=<name>` for an S3 bucket.
 */
export function storeConfigOf(where: string, toPath: (p: string) => string): StoreConfig {
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(where)?.[1]?.toLowerCase();
  if (scheme === undefined) return { kind: "dir", path: toPath(where) };

  if (scheme === "file") return { kind: "dir", path: toPath(fileURLToPath(where)) };

  if (scheme === "s3") return s3ConfigOf(where);
  throw new AccountError(`unknown store "${scheme}://"; pass a folder path or s3://…`);
}

/** The store as a person would type it again on another machine. */
export function storeWhere(config: StoreConfig): string {
  if (config.kind === "dir") return config.path;
  const query = new URLSearchParams(
    S3_SETTINGS.flatMap((name) => (config[name] ? [[name, config[name]]] : []))
  ).toString();

  const settings = query ? `?${query}` : "";

  return `s3://${config.bucket}/${config.prefix}${settings}`;
}

function s3StoreFor(config: StoreConfig & { kind: "s3" }): BlobStore {
  try {
    return s3Store(config, awsCredentials(config.profile));
  } catch (err) {
    if (err instanceof AwsCredentialsError) throw new AccountError(err.message);
    throw err;
  }
}

export function storeFor(config: StoreConfig): BlobStore {
  return config.kind === "s3" ? s3StoreFor(config) : directoryStore(config.path);
}

export function readAccount(home: string): SyncAccount | null {
  if (!existsSync(accountFile(home)) || !existsSync(accountKeyFile(home))) return null;
  const key = new Uint8Array(
    Buffer.from(readFileSync(accountKeyFile(home), "utf-8"), "base64")
  );

  return { store: storedConfig(home), key };
}

function storedConfig(home: string): StoreConfig {
  try {
    return (
      JSON.parse(readFileSync(accountFile(home), "utf-8")) as { store: StoreConfig }
    ).store;
  } catch {
    throw new AccountError(
      `the sync account file is not valid JSON: ${accountFile(home)}`
    );
  }
}

function saveAccount(home: string, account: SyncAccount): void {
  mkdirSync(syncStateDir(home), { recursive: true });
  writeFileSync(accountKeyFile(home), Buffer.from(account.key).toString("base64"), {
    mode: 0o600,
  });
  writeFileSync(
    accountFile(home),
    `${JSON.stringify({ store: account.store }, null, 2)}\n`
  );
}

function refuseIfSetUp(home: string): void {
  if (readAccount(home))
    throw new AccountError("sync is already set up on this machine: pal cli sync status");
}

/** A new account on an empty store; refused when the store already holds one. */
export async function setupAccount(
  home: string,
  config: StoreConfig,
  store: BlobStore = storeFor(config)
): Promise<Uint8Array<ArrayBuffer>> {
  refuseIfSetUp(home);
  const key = randomKey();
  saveAccount(home, { store: config, key });
  const check = await wrapDataKey(key, randomKey(), CHECK_ID);
  if (await store.put(CHECK_NAME, check, { ifAbsent: true })) {
    appendEvent("sync_account", { action: "setup", store: config.kind });

    return key;
  }

  forgetAccount(home);
  throw new AccountError(
    "this store already holds an account: join it with its recovery key (pal cli sync join)"
  );
}

function forgetAccount(home: string): void {
  rmSync(accountFile(home));
  rmSync(accountKeyFile(home));
}

/** Joins the account a store already holds, once the key opens its check blob. */
export async function joinAccount(
  home: string,
  config: StoreConfig,
  key: Uint8Array<ArrayBuffer>,
  store: BlobStore = storeFor(config)
): Promise<void> {
  refuseIfSetUp(home);
  const check = await store.get(CHECK_NAME);
  if (!check)
    throw new AccountError("this store holds no account yet: run pal cli sync setup");

  try {
    await unwrapDataKey(key, check, CHECK_ID);
  } catch {
    throw new AccountError("this recovery key does not open the store's account");
  }

  saveAccount(home, { store: config, key });
  appendEvent("sync_account", { action: "join", store: config.kind });
}
