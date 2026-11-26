/**
 * Each synced file's data key and logical path, as the store holds them:
 * `key/<id>` is the data key wrapped by the account key, `path/<id>` the path
 * sealed by the data key. The first machine to sync a file creates both.
 */

import type { BlobStore } from "./blob-store";
import {
  fileId,
  openBlob,
  randomKey,
  SyncCryptoError,
  sealBlob,
  unwrapDataKey,
  wrapDataKey,
} from "./crypto";

type Key = Uint8Array<ArrayBuffer>;

const PATH_PLACE = (id: string) => ({ fileId: id, machine: "path", seq: 0 });

export interface FileKeys {
  /** The id and data key for a local path, creating them in the store on first use. */
  forPath(path: string): Promise<{ id: string; dataKey: Key }>;
  /** The data key and logical path behind an id another machine created. */
  forId(id: string): Promise<{ path: string; dataKey: Key }>;
}

async function storedKey(
  store: BlobStore,
  account: Key,
  id: string
): Promise<Key | null> {
  const wrapped = await store.get(`key/${id}`);

  return wrapped ? unwrapDataKey(account, wrapped, id) : null;
}

/** The key is claimed first, so the path is always sealed by whichever key won a race. */
async function createKey(store: BlobStore, account: Key, id: string, path: string) {
  const mine = randomKey();
  const created = await store.put(`key/${id}`, await wrapDataKey(account, mine, id), {
    ifAbsent: true,
  });
  const dataKey = created ? mine : await storedKey(store, account, id);
  if (!dataKey) return null;
  const sealedPath = await sealBlob(
    dataKey,
    new TextEncoder().encode(path),
    PATH_PLACE(id)
  );
  await store.put(`path/${id}`, sealedPath, { ifAbsent: true });

  return dataKey;
}

export function fileKeys(store: BlobStore, account: Key): FileKeys {
  const keys = new Map<string, Key>();

  async function forPath(path: string) {
    const id = await fileId(account, path);
    const dataKey =
      keys.get(id) ??
      (await storedKey(store, account, id)) ??
      (await createKey(store, account, id, path));
    if (!dataKey) throw new SyncCryptoError("tampered");
    keys.set(id, dataKey);

    return { id, dataKey };
  }

  async function forId(id: string) {
    const dataKey = keys.get(id) ?? (await storedKey(store, account, id));
    const sealedPath = await store.get(`path/${id}`);
    if (!dataKey || !sealedPath) throw new SyncCryptoError("tampered");
    const path = new TextDecoder().decode(
      await openBlob(dataKey, sealedPath, PATH_PLACE(id))
    );

    if ((await fileId(account, path)) !== id) throw new SyncCryptoError("tampered");
    keys.set(id, dataKey);

    return { path, dataKey };
  }

  return { forPath, forId };
}
