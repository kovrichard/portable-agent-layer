/**
 * The blob store on S3. Bun's client has no conditional put, so a put that must
 * not replace goes through a presigned PUT carrying `If-None-Match: *`, which S3
 * answers with 412 when the key already holds an object.
 */

import { S3Client } from "bun";
import type { AwsCredentials } from "./aws-credentials";
import type { BlobStore } from "./blob-store";

export interface S3Place {
  bucket: string;
  prefix: string;
  endpoint?: string;
}

const PRECONDITION_FAILED = 412;

/** AWS by default, named outright so a stray S3_ENDPOINT cannot send the blobs elsewhere. */
export function awsEndpoint(region: string): string {
  return `https://s3.${region}.amazonaws.com`;
}

function clientFor(place: S3Place, credentials: AwsCredentials): S3Client {
  const region = credentials.region ?? "us-east-1";

  return new S3Client({
    bucket: place.bucket,
    region,
    endpoint: place.endpoint ?? awsEndpoint(region),
    accessKeyId: credentials.accessKeyId,
    secretAccessKey: credentials.secretAccessKey,
    sessionToken: credentials.sessionToken,
  });
}

async function putIfAbsent(client: S3Client, key: string, data: Uint8Array) {
  const response = await fetch(client.presign(key, { method: "PUT" }), {
    method: "PUT",
    headers: { "If-None-Match": "*" },
    body: new Uint8Array(data),
  });
  if (response.status === PRECONDITION_FAILED) return false;

  if (!response.ok)
    throw new Error(`S3 put ${key} failed: ${response.status} ${await response.text()}`);

  return true;
}

const isMissing = (err: unknown) => (err as { code?: string }).code === "NoSuchKey";

async function keysUnder(client: S3Client, prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let continuationToken: string | undefined;

  do {
    const page = await client.list({ prefix, continuationToken });
    keys.push(...(page.contents ?? []).map((entry) => entry.key));
    continuationToken = page.isTruncated ? page.nextContinuationToken : undefined;
  } while (continuationToken);

  return keys;
}

export function s3Store(place: S3Place, credentials: AwsCredentials): BlobStore {
  const client = clientFor(place, credentials);
  const root = place.prefix ? `${place.prefix.replace(/\/+$/, "")}/` : "";

  return {
    async put(name, data, options = {}) {
      if (options.ifAbsent) return putIfAbsent(client, root + name, data);
      await client.write(root + name, data);

      return true;
    },
    async get(name) {
      try {
        return new Uint8Array(await client.file(root + name).arrayBuffer());
      } catch (err) {
        if (isMissing(err)) return null;
        throw err;
      }
    },
    async list(prefix) {
      const keys = await keysUnder(client, root + prefix);

      return keys.map((key) => key.slice(root.length)).sort();
    },
  };
}
