#!/usr/bin/env bun

/**
 * PDF Download — Downloads a PDF from a URL and saves it to an organized local archive.
 *
 * Saves to: {PAL_ROOT}/memory/downloads/{YYYY}/{MM}/{DD}/{filename}.pdf
 *
 * Usage:
 *   bun run ai:pdf-download -- <url> [--filename <name.pdf>]
 *
 * Returns JSON with the saved file path for downstream reading.
 */

import { mkdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { parseArgs } from "node:util";
import { palHome } from "../hooks/lib/paths";

const DOWNLOADS_DIR = join(palHome(), "memory", "downloads");

function buildDatePath(): string {
  const now = new Date();
  const yyyy = now.getFullYear().toString();
  const mm = (now.getMonth() + 1).toString().padStart(2, "0");
  const dd = now.getDate().toString().padStart(2, "0");
  return join(yyyy, mm, dd);
}

function extractFilename(url: string, override?: string): string {
  if (override) {
    return override.endsWith(".pdf") ? override : `${override}.pdf`;
  }
  const urlPath = new URL(url).pathname;
  const name = basename(urlPath);
  return name.endsWith(".pdf") ? name : `${name}.pdf`;
}

async function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      filename: { type: "string", short: "f" },
    },
  });

  const url = positionals[0];
  if (!url) {
    console.error("Usage: bun run ai:pdf-download -- <url> [--filename <name.pdf>]");
    process.exit(1);
  }

  // Validate URL
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    console.error(`Error: Invalid URL: ${url}`);
    process.exit(1);
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    console.error(`Error: Only HTTP/HTTPS URLs are supported.`);
    process.exit(1);
  }

  // Download
  const response = await fetch(url);
  if (!response.ok) {
    console.error(`Error: HTTP ${response.status} ${response.statusText}`);
    process.exit(1);
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("pdf") && !url.endsWith(".pdf")) {
    console.error(`Warning: Content-Type is "${contentType}", may not be a PDF.`);
  }

  const buffer = await response.arrayBuffer();

  // Build destination path
  const datePath = buildDatePath();
  const dir = join(DOWNLOADS_DIR, datePath);
  await mkdir(dir, { recursive: true });

  const filename = extractFilename(url, values.filename);
  const filePath = join(dir, filename);

  // Write file
  await Bun.write(filePath, buffer);

  const result = {
    path: filePath,
    filename,
    size: buffer.byteLength,
    url,
    downloadedAt: new Date().toISOString(),
  };

  console.log(JSON.stringify(result, null, 2));
}

main();
