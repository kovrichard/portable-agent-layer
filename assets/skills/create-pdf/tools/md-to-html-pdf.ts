#!/usr/bin/env node
// create-pdf skill tool: Markdown -> HTML (marked, GFM) -> PDF (Playwright).
// Self-contained HTML: all CSS inlined, no CDN at render time.
//
// Run with Node (not Bun) — Playwright's chromium.launch hangs under Bun on Windows
// because it uses --remote-debugging-pipe over stdio and Bun's Windows child-process
// pipe handling doesn't complete the CDP handshake.
//
// Usage:
//   node --experimental-strip-types ~/.pal/skills/create-pdf/tools/md-to-html-pdf.ts <input.md> [--html <out.html>] [--pdf <out.pdf>]

import { readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { marked } from "marked";
import { chromium } from "playwright";

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("usage: md-to-html-pdf.ts <input.md> [--html <out>] [--pdf <out>]");
  process.exit(1);
}

const input = resolve(args[0]);
let htmlOut = "";
let pdfOut = "";
for (let i = 1; i < args.length; i++) {
  if (args[i] === "--html") htmlOut = resolve(args[++i]);
  else if (args[i] === "--pdf") pdfOut = resolve(args[++i]);
}
const stem = basename(input, extname(input));
const dir = dirname(input);
htmlOut ??= resolve(dir, `${stem}.html`);
pdfOut ??= resolve(dir, `${stem}.pdf`);

const md = await readFile(input, "utf8");
marked.setOptions({ gfm: true, breaks: false });
const body = await marked.parse(md);

const css = `
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
  font-size: 11px; line-height: 1.6; color: #1a1a1a; margin: 0;
}
h1 { font-size: 22px; border-bottom: 2px solid #333; padding-bottom: 8px; margin-top: 0; }
h2 { font-size: 17px; margin-top: 1.6em; }
h3 { font-size: 14px; }
h1, h2, h3, h4 { page-break-after: avoid; }
p, li { orphans: 3; widows: 3; }
hr { border: none; border-top: 1px solid #ccc; margin: 20px 0; }
a { color: #0366d6; text-decoration: none; }
blockquote { border-left: 3px solid #666; padding-left: 12px; color: #444; margin: 12px 0; }
code { background: #f4f4f4; padding: 1px 4px; border-radius: 3px; font-size: 10px; }
pre { background: #f4f4f4; padding: 10px; border-radius: 4px; overflow-x: auto; }
pre code { background: transparent; padding: 0; }
table { border-collapse: collapse; width: 100%; margin: 12px 0; page-break-inside: avoid; }
th, td { border: 1px solid #ccc; padding: 6px 10px; text-align: left; font-size: 10px; vertical-align: top; }
th { background: #f0f0f0; }
tr { page-break-inside: avoid; }
ul, ol { padding-left: 1.4em; }
`;

const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${stem}</title>
<style>${css}</style>
</head>
<body>
${body}
</body>
</html>
`;

await writeFile(htmlOut, html, "utf8");

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.goto(pathToFileURL(htmlOut).href, { waitUntil: "networkidle" });
  await page.pdf({
    path: pdfOut,
    format: "A4",
    margin: { top: "25mm", right: "25mm", bottom: "25mm", left: "25mm" },
    printBackground: true,
    preferCSSPageSize: false,
  });
} finally {
  await browser.close();
}

const [htmlStat, pdfStat] = await Promise.all([stat(htmlOut), stat(pdfOut)]);
console.log(`HTML: ${htmlOut} (${(htmlStat.size / 1024).toFixed(1)} KB)`);
console.log(`PDF:  ${pdfOut} (${(pdfStat.size / 1024).toFixed(1)} KB)`);
