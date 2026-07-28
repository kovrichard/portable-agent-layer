#!/usr/bin/env node

// consulting-report skill tool: build the Next.js report and render it to PDF.
// Pipeline: `next build` produces a static export at out/ — Playwright loads
// out/index.html and prints a PDF with branded header/footer/page numbers.
//
// Run with Node (not Bun) — Playwright's chromium.launch() hangs under Bun on
// Windows because it uses --remote-debugging-pipe over stdio and Bun's Windows
// child-process pipe handling doesn't complete the CDP handshake.
//
// pal-build:mjs — ships as a compiled generate-pdf.mjs sibling (scripts/build-skill-tools.ts)
// and is invoked as that .mjs: a .ts under node_modules can't be type-stripped by Node.
//
// Usage:
//   node ~/.pal/skills/consulting-report/tools/generate-pdf.mjs <report-dir> [--pdf <out>] [--html <out>] [--skip-build]

import { spawnSync } from "node:child_process";
import { createReadStream, constants as fsConstants, realpathSync } from "node:fs";
import { access, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { PDFDocument } from "pdf-lib";
import { chromium } from "playwright";

interface ReportMeta {
  clientName: string;
  reportTitle: string;
  classification: string;
  consultancyName: string;
  /** Public path to consultancy logo (e.g. "/logos/konvert7.svg"). Used in the PDF footer. */
  consultancyLogoSrc?: string;
  /** Public path to client logo (e.g. "/logos/transcend.svg"). Used in the PDF header. */
  clientLogoSrc?: string;
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
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Reads a logo file from the static export and returns a base64 data URI, or null if not found. */
async function logoDataUri(
  outDir: string,
  publicPath: string | undefined
): Promise<string | null> {
  if (!publicPath) return null;
  const filePath = join(outDir, publicPath);
  if (!(await exists(filePath))) return null;
  const buf = await readFile(filePath);
  const ext = extname(filePath).toLowerCase();
  let mime = "image/jpeg";
  if (ext === ".svg") {
    mime = "image/svg+xml";
  } else if (ext === ".png") {
    mime = "image/png";
  }
  return `data:${mime};base64,${buf.toString("base64")}`;
}

async function loadMeta(reportDir: string): Promise<ReportMeta> {
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

function buildNext(reportDir: string): void {
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

async function renderPdf(
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

    // Load logos as base64 data URIs — Playwright's header/footer templates
    // run in an isolated context and cannot load external or local-path URLs.
    const [clientUri, consultancyUri] = await Promise.all([
      logoDataUri(outDir, meta.clientLogoSrc),
      logoDataUri(outDir, meta.consultancyLogoSrc),
    ]);

    const clientSlot = clientUri
      ? `<img src="${clientUri}" style="height:18px; width:auto; object-fit:contain; display:block;">`
      : `<span style="font-weight:600; color:${COLOR.navy}; letter-spacing:0.05em;">${escapeHtml(meta.clientName.toUpperCase())}</span>`;

    const consultancySlot = consultancyUri
      ? `<img src="${consultancyUri}" style="height:14px; width:auto; object-fit:contain; display:block;">`
      : `<span style="color:${COLOR.navy};">${escapeHtml(meta.consultancyName)}</span>`;

    const header = `
<div style="width:100%; font-family:Inter,'Helvetica Neue',Arial,sans-serif; font-size:7.5pt; padding:0 0.7in; display:flex; justify-content:space-between; align-items:center;">
  ${clientSlot}
  <span style="color:#94a3b8;">${escapeHtml(meta.reportTitle)}</span>
</div>`;

    // Footer: consultancy logo left, page number right — no classification (cover carries it)
    const footer = `
<div style="width:100%; font-family:Inter,'Helvetica Neue',Arial,sans-serif; font-size:7.5pt; padding:0 0.7in; display:flex; justify-content:space-between; align-items:center;">
  ${consultancySlot}
  <span style="color:${COLOR.navy};"><span class="pageNumber"></span></span>
</div>`;

    const margin = { top: "0.7in", right: "0.7in", bottom: "0.7in", left: "0.7in" };

    // Render cover (page 1) and body (pages 2+) separately so the cover has
    // no header/footer and full-bleed margins, then merge with pdf-lib.
    const tmpCover = `${pdfPath}.cover.tmp.pdf`;
    const tmpBody = `${pdfPath}.body.tmp.pdf`;

    await Promise.all([
      page.pdf({
        path: tmpCover,
        format: "A4",
        pageRanges: "1",
        printBackground: true,
        displayHeaderFooter: false,
        margin: { top: "0", right: "0", bottom: "0", left: "0" },
        preferCSSPageSize: false,
      }),
      page.pdf({
        path: tmpBody,
        format: "A4",
        pageRanges: "2-",
        printBackground: true,
        displayHeaderFooter: true,
        headerTemplate: header,
        footerTemplate: footer,
        margin,
        preferCSSPageSize: false,
      }),
    ]);

    // Merge: use body PDF as the base so its named destinations and link
    // annotations stay intact. Insert the cover page at position 0.
    const [coverBytes, bodyBytes] = await Promise.all([
      readFile(tmpCover),
      readFile(tmpBody),
    ]);
    const [coverDoc, bodyDoc] = await Promise.all([
      PDFDocument.load(coverBytes),
      PDFDocument.load(bodyBytes),
    ]);
    const [coverPage] = await bodyDoc.copyPages(coverDoc, [0]);
    bodyDoc.insertPage(0, coverPage);
    await writeFile(pdfPath, await bodyDoc.save());

    await Promise.all([unlink(tmpCover), unlink(tmpBody)]);
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

async function generate(opts: GenerateOptions): Promise<{
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

async function run(argv: string[] = process.argv.slice(2)): Promise<void> {
  const opts = parseArgs(argv);
  const { htmlPath, pdfPath } = await generate(opts);
  const [htmlStat, pdfStat] = await Promise.all([stat(htmlPath), stat(pdfPath)]);
  console.log(`HTML: ${htmlPath} (${(htmlStat.size / 1024).toFixed(1)} KB)`);
  console.log(`PDF:  ${pdfPath} (${(pdfStat.size / 1024).toFixed(1)} KB)`);
}

// Node ≥ 22.6 doesn't expose import.meta.main; gate on argv[1] instead.
// Use realpathSync on both sides so symlinked skill paths (e.g. ~/.pal/skills →
// PAL repo) match the resolved import.meta.url.
function realResolve(p: string): string {
  try {
    return realpathSync(resolve(p));
  } catch {
    return resolve(p);
  }
}
const isMain =
  process.argv[1] &&
  realResolve(process.argv[1]) === realResolve(new URL(import.meta.url).pathname);
if (isMain) {
  await run();
}
