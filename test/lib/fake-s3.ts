/**
 * A path-style S3 that holds objects in memory: PUT with `If-None-Match: *`,
 * GET, and ListObjectsV2 in pages of `pageSize`. It checks no signature.
 */

export interface FakeS3 {
  endpoint: string;
  objects: Map<string, Uint8Array>;
  requests: { method: string; key: string; headers: Headers }[];
  pageSize: number;
  reset: (pageSize?: number) => void;
}

const xml = (body: string, status = 200) =>
  new Response(`<?xml version="1.0" encoding="UTF-8"?>${body}`, {
    status,
    headers: { "Content-Type": "application/xml" },
  });

const escapeXml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function errorReply(status: number, code: string) {
  return xml(`<Error><Code>${code}</Code><Message>${code}</Message></Error>`, status);
}

function listReply(objects: Map<string, Uint8Array>, url: URL, pageSize: number) {
  const prefix = url.searchParams.get("prefix") ?? "";
  const after = url.searchParams.get("continuation-token") ?? "";
  const keys = [...objects.keys()]
    .filter((key) => key.startsWith(prefix) && key > after)
    .sort();
  const page = keys.slice(0, pageSize);
  const truncated = keys.length > pageSize;
  const contents = page
    .map((key) => `<Contents><Key>${escapeXml(key)}</Key><Size>1</Size></Contents>`)
    .join("");
  const next = truncated
    ? `<NextContinuationToken>${escapeXml(page.at(-1) ?? "")}</NextContinuationToken>`
    : "";

  return xml(
    `<ListBucketResult><Name>b</Name><Prefix>${escapeXml(prefix)}</Prefix><KeyCount>${page.length}</KeyCount><MaxKeys>${pageSize}</MaxKeys><IsTruncated>${truncated}</IsTruncated>${contents}${next}</ListBucketResult>`
  );
}

async function putReply(objects: Map<string, Uint8Array>, key: string, req: Request) {
  if (req.headers.get("if-none-match") === "*" && objects.has(key))
    return errorReply(412, "PreconditionFailed");
  objects.set(key, new Uint8Array(await req.arrayBuffer()));

  return new Response(null, { status: 200 });
}

/** One per test file; each test calls `reset` first, so no state crosses tests. */
export function fakeS3(bucket: string): FakeS3 {
  const fake = { objects: new Map(), requests: [], pageSize: 1000 } as Omit<
    FakeS3,
    "endpoint" | "reset"
  >;
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      const [, name, ...rest] = url.pathname.split("/");
      const key = decodeURIComponent(rest.join("/"));
      fake.requests.push({ method: req.method, key, headers: req.headers });

      if (name !== bucket) return errorReply(404, "NoSuchBucket");

      if (req.method === "PUT") return putReply(fake.objects, key, req);

      if (!key) return listReply(fake.objects, url, fake.pageSize);
      const body = fake.objects.get(key);

      return body ? new Response(new Uint8Array(body)) : errorReply(404, "NoSuchKey");
    },
  });
  server.unref();

  return Object.assign(fake, {
    endpoint: `http://localhost:${server.port}`,
    reset: (pageSize = 1000) => {
      fake.objects.clear();
      fake.requests.length = 0;
      fake.pageSize = pageSize;
    },
  });
}
