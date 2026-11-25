/**
 * A transcript read line by line from a byte offset, never whole. One session's
 * transcript can pass a gigabyte, and reading every transcript whole into memory
 * once froze the machine for two hours. Memory here stays at one chunk plus the
 * longest line, whatever the file's size.
 */

import {
  closeSync,
  createReadStream,
  fstatSync,
  openSync,
  readSync,
  statSync,
} from "node:fs";
import { createGunzip } from "node:zlib";

export interface TranscriptLine {
  text: string;
  start: number;
  end: number;
}

const CHUNK_BYTES = 1024 * 1024;
const NEWLINE = 10;
const GZIP = ".gz";

async function* skipBytes(
  chunks: AsyncIterable<Buffer>,
  count: number
): AsyncGenerator<Buffer> {
  let left = count;

  for await (const chunk of chunks) {
    if (left >= chunk.length) {
      left -= chunk.length;
      continue;
    }

    yield left > 0 ? chunk.subarray(left) : chunk;
    left = 0;
  }
}

/** A gzipped copy cannot seek, so its first `offset` bytes are inflated and dropped. */
function chunksFrom(path: string, offset: number): AsyncIterable<Buffer> {
  if (!path.endsWith(GZIP))
    return createReadStream(path, { start: offset, highWaterMark: CHUNK_BYTES });

  const inflated = createReadStream(path, { highWaterMark: CHUNK_BYTES }).pipe(
    createGunzip({ chunkSize: CHUNK_BYTES })
  );

  return skipBytes(inflated, offset);
}

/** Every complete line after `offset`; a last line no newline has ended yet is left for the next read. */
export async function* transcriptLines(
  path: string,
  offset = 0
): AsyncGenerator<TranscriptLine> {
  let pending = Buffer.alloc(0);
  let pendingStart = offset;

  for await (const chunk of chunksFrom(path, offset)) {
    const bytes = pending.length > 0 ? Buffer.concat([pending, chunk]) : chunk;
    let from = 0;

    for (;;) {
      const newline = bytes.indexOf(NEWLINE, from);
      if (newline === -1) break;
      yield {
        text: bytes.toString("utf-8", from, newline),
        start: pendingStart + from,
        end: pendingStart + newline + 1,
      };
      from = newline + 1;
    }

    pending = Buffer.from(bytes.subarray(from));
    pendingStart += from;
  }
}

/** The gzip trailer holds the inflated size modulo 4 GiB, so a copy's length is known without inflating it. */
function inflatedSize(path: string): number {
  const fd = openSync(path, "r");

  try {
    const trailer = Buffer.alloc(4);
    readSync(fd, trailer, 0, 4, fstatSync(fd).size - 4);

    return trailer.readUInt32LE(0);
  } catch {
    return Number.POSITIVE_INFINITY;
  } finally {
    closeSync(fd);
  }
}

/** The transcript's length in bytes as its lines count them, for a gzipped copy too. */
export function transcriptBytes(path: string): number {
  return path.endsWith(GZIP) ? inflatedSize(path) : statSync(path).size;
}
