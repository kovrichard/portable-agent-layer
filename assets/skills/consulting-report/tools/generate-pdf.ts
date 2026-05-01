#!/usr/bin/env node

// consulting-report skill tool: build the Next.js report and render it to PDF.
// Pipeline: `next build` produces a static export at out/ — Playwright loads
// out/index.html and prints a PDF with branded header/footer/page numbers.
//
// Run with Node (not Bun) — Playwright's chromium.launch() hangs under Bun on
// Windows because it uses --remote-debugging-pipe over stdio and Bun's Windows
// child-process pipe handling doesn't complete the CDP handshake.
//
// Usage:
//   node --experimental-strip-types ~/.pal/skills/consulting-report/tools/generate-pdf.ts <report-dir> [--pdf <out>] [--html <out>] [--skip-build]

import { spawnSync } from "node:child_process";
import { createReadStream, constants as fsConstants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

interface ReportMeta {
  clientName: string;
  reportTitle: string;
  classification: string;
  consultancyName: string;
}

const COLOR = {
  navy: "#0f172a",
  blue: "#1d4ed8",
  red: "#dc2626",
};

async function exists(p: string): Promise<boolean> {
  try {
    await access(p, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export async function loadMeta(reportDir: string): Promise<ReportMeta> {
  const dataPath = join(reportDir, "lib", "report-data.ts");
  if (!(await exists(dataPath))) {
    throw new Error(`lib/report-data.ts not found at ${dataPath}`);
  }
  const mod = (await import(pathToFileURL(dataPath).href)) as {
    reportData?: ReportMeta;
  };
  if (!mod.reportData) {
    throw new Error(`lib/report-data.ts must export a named 'reportData' constant`);
  }
  return mod.reportData;
}

export function buildNext(reportDir: string): void {
  const result = spawnSync("bun", ["run", "build"], {
    cwd: reportDir,
    stdio: "inherit",
    shell: true,
  });
  if (result.status !== 0) {
    throw new Error(`next build failed (exit ${result.status})`);
  }
}

// Static export uses absolute paths (e.g. /_next/static/...). Loading via
// file:// breaks those because `/` resolves to the filesystem root. Spin up a
// tiny HTTP server rooted at out/ so Playwright sees real URLs.
function serveStatic(rootDir: string): Promise<{ server: Server; url: string }> {
  const MIME: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
  };
  return new Promise((res) => {
    const server = createServer((req, response) => {
      const urlPath = decodeURIComponent((req.url ?? "/").split("?")[0]);
      let filePath = join(rootDir, urlPath === "/" ? "/index.html" : urlPath);
      if (filePath.endsWith("/")) filePath = join(filePath, "index.html");
      const ext = extname(filePath).toLowerCase();
      response.setHeader("Content-Type", MIME[ext] ?? "application/octet-stream");
      const stream = createReadStream(filePath);
      stream.on("error", () => {
        response.statusCode = 404;
        response.end();
      });
      stream.pipe(response);
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      res({ server, url: `http://127.0.0.1:${port}/` });
    });
  });
}

export async function renderPdf(
  htmlPath: string,
  pdfPath: string,
  meta: ReportMeta
): Promise<void> {
  const outDir = resolve(htmlPath, "..");
  const { server, url } = await serveStatic(outDir);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "networkidle" });

    // Wait for fonts and images to settle
    await page.evaluate(async () => {
      await (document as { fonts?: { ready: Promise<unknown> } }).fonts?.ready;
      const imgs = Array.from(document.querySelectorAll("img"));
      await Promise.all(
        imgs.map((img) =>
          img.complete
            ? Promise.resolve()
            : new Promise((res) => {
                img.onload = () => res(null);
                img.onerror = () => res(null);
                setTimeout(() => res(null), 5000);
              })
        )
      );
    });

    const header = `
<div style="width:100%; font-family:Inter,'Helvetica Neue',Arial,sans-serif; font-size:7.5pt; padding:0 0.7in; display:flex; justify-content:space-between; align-items:center;">
  <span style="font-weight:600; color:${COLOR.navy}; letter-spacing:0.05em;">${escapeHtml(meta.clientName.toUpperCase())}</span>
  <span style="color:#94a3b8;">${escapeHtml(meta.reportTitle)}</span>
</div>`;

    const footer = `
<div style="width:100%; font-family:Inter,'Helvetica Neue',Arial,sans-serif; font-size:7.5pt; padding:0 0.7in; display:flex; justify-content:space-between; align-items:center;">
  <span style="color:${COLOR.red}; font-weight:600; letter-spacing:0.05em;">${escapeHtml(meta.classification)}</span>
  <span style="color:${COLOR.navy};">${escapeHtml(meta.consultancyName)}</span>
  <span style="color:${COLOR.navy};"><span class="pageNumber"></span></span>
</div>`;

    await page.pdf({
      path: pdfPath,
      format: "A4",
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: header,
      footerTemplate: footer,
      margin: { top: "0.7in", right: "0.7in", bottom: "0.7in", left: "0.7in" },
      preferCSSPageSize: false,
    });
  } finally {
    await browser.close();
    server.close();
  }
}

interface GenerateOptions {
  reportDir: string;
  pdfOut?: string;
  htmlOut?: string;
  skipBuild?: boolean;
}

export async function generate(opts: GenerateOptions): Promise<{
  htmlPath: string;
  pdfPath: string;
}> {
  const dir = resolve(opts.reportDir);
  if (!(await exists(join(dir, "package.json")))) {
    throw new Error(`not a scaffolded report (missing package.json): ${dir}`);
  }

  if (!opts.skipBuild) {
    buildNext(dir);
  }

  const htmlPath = join(dir, "out", "index.html");
  if (!(await exists(htmlPath))) {
    throw new Error(`static export missing: ${htmlPath} — run without --skip-build`);
  }

  const meta = await loadMeta(dir);
  const slug = `${slugify(meta.clientName)}-${slugify(meta.reportTitle)}-${slugify(
    new Date().toISOString().slice(0, 10)
  )}`;
  const pdfPath = opts.pdfOut ? resolve(opts.pdfOut) : join(dir, `${slug}.pdf`);

  await renderPdf(htmlPath, pdfPath, meta);
  return { htmlPath, pdfPath };
}

function parseArgs(argv: string[]): GenerateOptions {
  if (argv.length === 0) {
    throw new Error("usage: generate-pdf.ts <report-dir> [--pdf <out>] [--skip-build]");
  }
  const opts: GenerateOptions = { reportDir: argv[0] };
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === "--pdf") opts.pdfOut = argv[++i];
    else if (argv[i] === "--html") opts.htmlOut = argv[++i];
    else if (argv[i] === "--skip-build") opts.skipBuild = true;
  }
  return opts;
}

export async function run(argv: string[] = process.argv.slice(2)): Promise<void> {
  const opts = parseArgs(argv);
  const { htmlPath, pdfPath } = await generate(opts);
  const [htmlStat, pdfStat] = await Promise.all([stat(htmlPath), stat(pdfPath)]);
  console.log(`HTML: ${htmlPath} (${(htmlStat.size / 1024).toFixed(1)} KB)`);
  console.log(`PDF:  ${pdfPath} (${(pdfStat.size / 1024).toFixed(1)} KB)`);
}

// Node ≥ 22.6 doesn't expose import.meta.main; gate on argv[1] instead.
const isMain =
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname);
if (isMain) {
  await run();
}
