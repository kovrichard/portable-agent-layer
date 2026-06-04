#!/usr/bin/env bun

/**
 * PDF Read — Extracts text from a local PDF file, page by page.
 *
 * Usage:
 *   bun pdf-read.ts -- <path/to/file.pdf>
 *
 * Prints each page's text to stdout separated by a page marker.
 */

import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { extractText, getDocumentProxy } from "unpdf";

async function main() {
  const { positionals } = parseArgs({ allowPositionals: true, options: {} });

  const filePath = positionals[0];
  if (!filePath) {
    console.error("Usage: bun pdf-read.ts -- <path/to/file.pdf>");
    process.exit(1);
  }

  const buffer = await readFile(filePath);
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { totalPages, text } = await extractText(pdf, { mergePages: false });

  for (let i = 0; i < totalPages; i++) {
    console.log(`--- Page ${i + 1} ---`);
    console.log(text[i]);
  }
}

void main();
