#!/usr/bin/env bun

// consulting-report skill tool: render a structured report directory to a branded PDF.
// Pipeline: report-data.ts + section markdown + diagrams -> HTML -> PDF (Playwright).
//
// Usage:
//   bun ~/.pal/skills/consulting-report/tools/generate-pdf.ts <report-dir> [--pdf <out>] [--html <out>]
//
// <report-dir> must contain content/report-data.ts (default export or named `report`).

import { spawnSync } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { marked } from "marked";
import { chromium } from "playwright";

// ── Types ────────────────────────────────────────────────────────────────────

export interface Brand {
  businessName: string;
  brandLabel?: string; // sub-label shown under logo on cover (e.g. "TELOS Assessment")
  logoPath?: string; // absolute filesystem path; text-only cover if missing
}

export interface Section {
  id: string;
  title: string;
  content: string; // markdown string OR a path relative to content/ ending in .md
  subsections?: Section[];
}

export interface Finding {
  id: string;
  title: string;
  severity: "critical" | "high" | "medium" | "low";
  evidence: string; // markdown
  impact?: string;
}

export interface Recommendation {
  id: string;
  title: string;
  priority: "immediate" | "short-term" | "long-term";
  detail: string; // markdown
  owner?: string;
}

export interface Conclusion {
  assessorNote?: string;
  contextNote?: string;
  closingRemarks?: string;
}

export interface ConsultingReport {
  clientName: string;
  reportTitle: string;
  reportDate: string;
  classification: string;
  version: string;
  brand?: Brand;
  sections: Section[];
  findings?: Finding[];
  recommendations?: Recommendation[];
  conclusion?: Conclusion;
  supportingEvidence?: Record<string, string[]>;
}

// ── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_BRAND: Brand = {
  businessName: "Konvert7",
  brandLabel: "Konvert7 Assessment",
};

// Color palette (ported verbatim from PAI's ConsultingReport workflow).
const COLOR = {
  navy: "#1B2A4A",
  blue: "#2E5090",
  red: "#DC2626",
  amber: "#D97706",
  green: "#059669",
};

// ── Helpers ──────────────────────────────────────────────────────────────────

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

async function resolveMarkdown(content: string, contentDir: string): Promise<string> {
  // If `content` looks like a relative path to an existing .md file, load it.
  // Otherwise treat it as inline markdown.
  if (content.endsWith(".md") && !content.includes("\n")) {
    const p = isAbsolute(content) ? content : join(contentDir, content);
    if (await exists(p)) return readFile(p, "utf8");
  }
  return content;
}

// Compress diagrams with sips (macOS) to JPEG 70% max 1200px wide.
// Idempotent — outputs to diagrams-compressed/. Gracefully skips if sips missing.
async function compressDiagrams(reportDir: string): Promise<string> {
  const srcDir = join(reportDir, "diagrams");
  const outDir = join(reportDir, "diagrams-compressed");
  if (!(await exists(srcDir))) return srcDir;

  const sipsCheck = spawnSync("which", ["sips"], { stdio: "ignore" });
  if (sipsCheck.status !== 0) {
    return srcDir; // no sips — serve originals
  }

  await spawnSync("mkdir", ["-p", outDir], { stdio: "ignore" });
  const files = await readdir(srcDir);
  for (const file of files) {
    if (!/\.(png|jpg|jpeg)$/i.test(file)) continue;
    const base = file.replace(/\.[^.]+$/, "");
    const src = join(srcDir, file);
    const dst = join(outDir, `${base}.jpg`);
    if (await exists(dst)) {
      const [srcStat, dstStat] = await Promise.all([stat(src), stat(dst)]);
      if (dstStat.mtimeMs >= srcStat.mtimeMs) continue;
    }
    spawnSync(
      "sips",
      [
        "-s",
        "format",
        "jpeg",
        "-s",
        "formatOptions",
        "70",
        "--resampleWidth",
        "1200",
        src,
        "--out",
        dst,
      ],
      { stdio: "ignore" }
    );
  }
  return outDir;
}

// ── HTML builders ────────────────────────────────────────────────────────────

function css(): string {
  return `
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body {
  font-family: Georgia, Garamond, "Times New Roman", serif;
  font-size: 10.5pt;
  line-height: 1.55;
  color: #1a1a2e;
  margin: 0;
}
h1, h2, h3, h4 { font-family: Inter, "Helvetica Neue", Arial, sans-serif; page-break-after: avoid; }
h1 { font-size: 22pt; color: ${COLOR.navy}; border-bottom: 2px solid ${COLOR.navy}; padding-bottom: 6px; margin-top: 0; page-break-before: always; }
h2 { font-size: 15pt; color: ${COLOR.blue}; margin-top: 1.4em; }
h3 { font-size: 12pt; color: ${COLOR.navy}; margin-top: 1.1em; }
p, li { orphans: 3; widows: 3; }
a { color: ${COLOR.blue}; text-decoration: none; }
blockquote { border-left: 3px solid ${COLOR.blue}; padding-left: 12px; color: #333; margin: 12px 0; font-style: italic; }
code { background: #f4f4f4; padding: 1px 4px; border-radius: 3px; font-size: 9.5pt; font-family: "SF Mono", Menlo, Consolas, monospace; }
pre { background: #f4f4f4; padding: 10px; border-radius: 4px; overflow-x: auto; page-break-inside: avoid; }
pre code { background: transparent; padding: 0; }
hr { border: none; border-top: 1px solid #e2e8f0; margin: 20px 0; }
ul, ol { padding-left: 1.4em; }
img { max-width: 100%; height: auto; }

table { border-collapse: collapse; width: 100%; margin: 12px 0; page-break-inside: avoid; font-family: Inter, "Helvetica Neue", Arial, sans-serif; font-size: 9.5pt; }
thead th { background: ${COLOR.navy}; color: #fff; font-size: 9pt; padding: 8px 10px; text-align: left; }
tbody td { padding: 7px 10px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
tbody tr:nth-child(even) { background: #f8fafc; }
tr { page-break-inside: avoid; }

.cover { height: 100vh; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; padding: 0 1in; page-break-after: always; }
.cover .classification { position: absolute; top: 40px; font-family: Inter, sans-serif; font-size: 10pt; font-weight: 700; color: ${COLOR.red}; letter-spacing: 0.2em; }
.cover .logo { max-width: 220px; max-height: 120px; margin-bottom: 16px; }
.cover .brand-label { font-family: Inter, sans-serif; font-size: 11pt; letter-spacing: 0.15em; color: ${COLOR.blue}; text-transform: uppercase; margin-bottom: 48px; }
.cover .report-title { font-family: Inter, sans-serif; font-size: 30pt; font-weight: 700; color: ${COLOR.navy}; line-height: 1.2; margin-bottom: 16px; }
.cover .prepared-for { font-size: 14pt; color: #334155; margin-bottom: 28px; }
.cover .divider { width: 120px; height: 2px; background: ${COLOR.navy}; margin: 16px auto; }
.cover .meta { font-family: Inter, sans-serif; font-size: 10pt; color: #64748b; letter-spacing: 0.05em; }
.cover .company-name { position: absolute; bottom: 80px; font-family: Inter, sans-serif; font-size: 12pt; font-weight: 700; color: ${COLOR.navy}; letter-spacing: 0.2em; }
.cover .footer-note { position: absolute; bottom: 40px; font-size: 8.5pt; color: #94a3b8; font-style: italic; }

.toc { page-break-after: always; }
.toc h1 { page-break-before: avoid; }
.toc ol { list-style: none; padding-left: 0; font-family: Inter, sans-serif; font-size: 11pt; }
.toc ol ol { padding-left: 1.4em; font-size: 10pt; margin-top: 4px; }
.toc li { margin: 6px 0; }
.toc a { color: ${COLOR.navy}; display: flex; justify-content: space-between; border-bottom: 1px dotted #cbd5e1; padding-bottom: 3px; }
.toc .toc-title { }
.toc .toc-page { color: #94a3b8; font-size: 9pt; }

.box { padding: 0.7rem 1rem; border-radius: 4px; border-left: 4px solid; margin: 12px 0; page-break-inside: avoid; }
.box-red { border-color: ${COLOR.red}; background: #fef2f2; color: #7f1d1d; }
.box-green { border-color: ${COLOR.green}; background: #f0fdf4; color: #14532d; }
.box-amber { border-color: ${COLOR.amber}; background: #fffbeb; color: #78350f; }
.box-blue { border-color: ${COLOR.blue}; background: #f0f4fa; color: ${COLOR.navy}; }

.badge { display: inline-block; padding: 1px 8px; border-radius: 3px; font-family: Inter, sans-serif; font-size: 8.5pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; margin-left: 8px; vertical-align: middle; }
.badge-critical, .badge-immediate { background: ${COLOR.red}; color: #fff; }
.badge-short-term { background: ${COLOR.amber}; color: #fff; }
.badge-long-term { background: ${COLOR.green}; color: #fff; }
.badge-high { background: ${COLOR.amber}; color: #fff; }
.badge-medium { background: ${COLOR.blue}; color: #fff; }
.badge-low { background: #64748b; color: #fff; }

.finding, .recommendation { margin: 16px 0; page-break-inside: avoid; }
.finding h3, .recommendation h3 { margin-top: 0; }
.finding .label, .recommendation .label { display: block; font-family: Inter, sans-serif; font-size: 9pt; font-weight: 700; letter-spacing: 0.08em; color: #64748b; text-transform: uppercase; margin-bottom: 4px; }
`;
}

async function renderSections(
  sections: Section[],
  contentDir: string,
  depth = 1
): Promise<string> {
  const out: string[] = [];
  for (const s of sections) {
    const md = await resolveMarkdown(s.content, contentDir);
    const htmlBody = await marked.parse(md);
    const tag = depth === 1 ? "h1" : depth === 2 ? "h2" : "h3";
    out.push(`<${tag} id="${s.id}">${escapeHtml(s.title)}</${tag}>`);
    out.push(htmlBody as string);
    if (s.subsections && s.subsections.length) {
      out.push(await renderSections(s.subsections, contentDir, depth + 1));
    }
  }
  return out.join("\n");
}

function renderToc(sections: Section[]): string {
  const renderItems = (items: Section[]): string =>
    `<ol>${items
      .map(
        (s) =>
          `<li><a href="#${s.id}"><span class="toc-title">${escapeHtml(s.title)}</span></a>${
            s.subsections?.length ? renderItems(s.subsections) : ""
          }</li>`
      )
      .join("")}</ol>`;

  return `<div class="toc"><h1 id="toc">Table of Contents</h1>${renderItems(sections)}</div>`;
}

function renderCover(r: ConsultingReport, brand: Brand): string {
  const logo =
    brand.logoPath && brand.logoPath.length
      ? `<img class="logo" src="file://${brand.logoPath}" alt="${escapeHtml(brand.businessName)}">`
      : "";
  const brandLabel = brand.brandLabel || `${brand.businessName} Assessment`;
  return `
<div class="cover">
  <div class="classification">${escapeHtml(r.classification)}</div>
  ${logo}
  <div class="brand-label">${escapeHtml(brandLabel)}</div>
  <div class="report-title">${escapeHtml(r.reportTitle)}</div>
  <div class="prepared-for">Prepared for ${escapeHtml(r.clientName)}</div>
  <div class="divider"></div>
  <div class="meta">${escapeHtml(r.reportDate)} · Version ${escapeHtml(r.version)}</div>
  <div class="company-name">${escapeHtml(brand.businessName.toUpperCase())} CONSULTING</div>
  <div class="footer-note">${escapeHtml(r.classification)} — For Authorized Recipients Only</div>
</div>
`;
}

async function renderFindings(findings: Finding[] | undefined): Promise<string> {
  if (!findings || !findings.length) return "";
  const parts = [`<h1 id="findings">Findings</h1>`];
  for (const f of findings) {
    const boxClass =
      f.severity === "critical" || f.severity === "high"
        ? "box-red"
        : f.severity === "medium"
          ? "box-amber"
          : "box-blue";
    const evidenceHtml = await marked.parse(f.evidence);
    const impactHtml = f.impact ? await marked.parse(f.impact) : "";
    parts.push(`
<div class="finding box ${boxClass}" id="${f.id}">
  <span class="label">Finding — ${escapeHtml(f.severity)}<span class="badge badge-${escapeHtml(f.severity)}">${escapeHtml(f.severity)}</span></span>
  <h3>${escapeHtml(f.title)}</h3>
  ${evidenceHtml}
  ${impactHtml ? `<p><strong>Impact:</strong></p>${impactHtml}` : ""}
</div>`);
  }
  return parts.join("\n");
}

async function renderRecommendations(
  recs: Recommendation[] | undefined
): Promise<string> {
  if (!recs || !recs.length) return "";
  const parts = [`<h1 id="recommendations">Recommendations</h1>`];
  for (const r of recs) {
    const detailHtml = await marked.parse(r.detail);
    parts.push(`
<div class="recommendation box box-blue" id="${r.id}">
  <span class="label">Recommendation<span class="badge badge-${escapeHtml(r.priority)}">${escapeHtml(r.priority)}</span></span>
  <h3>${escapeHtml(r.title)}</h3>
  ${detailHtml}
  ${r.owner ? `<p><strong>Owner:</strong> ${escapeHtml(r.owner)}</p>` : ""}
</div>`);
  }
  return parts.join("\n");
}

async function renderConclusion(c: Conclusion | undefined): Promise<string> {
  if (!c) return "";
  const bits: string[] = [`<h1 id="conclusion">Conclusion</h1>`];
  if (c.assessorNote)
    bits.push(
      `<h3>Assessor's Note</h3>${(await marked.parse(c.assessorNote)) as string}`
    );
  if (c.contextNote)
    bits.push(`<h3>Context</h3>${(await marked.parse(c.contextNote)) as string}`);
  if (c.closingRemarks)
    bits.push(
      `<h3>Closing Remarks</h3>${(await marked.parse(c.closingRemarks)) as string}`
    );
  return bits.join("\n");
}

async function renderAppendix(
  evidence: Record<string, string[]> | undefined
): Promise<string> {
  if (!evidence) return "";
  const entries = Object.entries(evidence);
  if (!entries.length) return "";
  const parts = [`<h1 id="appendix">Appendix — Supporting Evidence</h1>`];
  for (const [heading, items] of entries) {
    parts.push(`<h3>${escapeHtml(heading)}</h3>`);
    parts.push(`<ul>${items.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul>`);
  }
  return parts.join("\n");
}

async function buildHtml(report: ConsultingReport, contentDir: string): Promise<string> {
  marked.setOptions({ gfm: true, breaks: false });
  const brand: Brand = { ...DEFAULT_BRAND, ...(report.brand || {}) };

  const [sectionsHtml, findingsHtml, recsHtml, conclusionHtml, appendixHtml] =
    await Promise.all([
      renderSections(report.sections, contentDir),
      renderFindings(report.findings),
      renderRecommendations(report.recommendations),
      renderConclusion(report.conclusion),
      renderAppendix(report.supportingEvidence),
    ]);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(report.reportTitle)} — ${escapeHtml(report.clientName)}</title>
<style>${css()}</style>
</head>
<body>
${renderCover(report, brand)}
${renderToc(report.sections)}
${sectionsHtml}
${findingsHtml}
${recsHtml}
${conclusionHtml}
${appendixHtml}
</body>
</html>
`;
}

// ── Playwright ───────────────────────────────────────────────────────────────

async function renderPdf(
  htmlPath: string,
  pdfPath: string,
  report: ConsultingReport,
  brand: Brand
) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(`file://${htmlPath}`, { waitUntil: "networkidle" });

    // Wait for all images
    await page.evaluate(async () => {
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
<div style="width:100%; font-family:'Helvetica Neue',Arial,sans-serif; font-size:7.5pt; padding:0 0.9in 4px; display:flex; justify-content:space-between; align-items:center; border-bottom:0.5px solid #d0d5dd;">
  <span style="font-weight:700; color:${COLOR.navy}; letter-spacing:0.05em;">${escapeHtml(report.clientName.toUpperCase())}</span>
  <span style="color:#94a3b8; letter-spacing:0.03em;">${escapeHtml(report.reportTitle)}</span>
</div>`;

    const footer = `
<div style="width:100%; font-family:'Helvetica Neue',Arial,sans-serif; font-size:7.5pt; padding:4px 0.9in 0; display:flex; justify-content:space-between; align-items:center; border-top:0.5px solid #d0d5dd;">
  <span style="color:${COLOR.red}; font-weight:600; letter-spacing:0.05em;">${escapeHtml(report.classification)}</span>
  <span style="color:${COLOR.navy};">${escapeHtml(brand.businessName)} Consulting</span>
  <span style="color:${COLOR.navy};">Page <span class="pageNumber"></span></span>
</div>`;

    await page.pdf({
      path: pdfPath,
      format: "A4",
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: header,
      footerTemplate: footer,
      margin: { top: "0.8in", right: "0.9in", bottom: "0.7in", left: "0.9in" },
      preferCSSPageSize: false,
    });
  } finally {
    await browser.close();
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function loadReport(
  reportDir: string
): Promise<{ report: ConsultingReport; contentDir: string }> {
  const dataPath = join(reportDir, "content", "report-data.ts");
  if (!(await exists(dataPath))) {
    throw new Error(`report-data.ts not found at ${dataPath}`);
  }
  const mod: { default?: ConsultingReport; report?: ConsultingReport } = await import(
    dataPath
  );
  const report = mod.default || mod.report;
  if (!report) {
    throw new Error(
      `report-data.ts must export a default ConsultingReport or a named export 'report'`
    );
  }
  return { report, contentDir: join(reportDir, "content") };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error("usage: generate-pdf.ts <report-dir> [--pdf <out>] [--html <out>]");
    process.exit(1);
  }

  const reportDir = resolve(args[0]);
  let pdfOut = "";
  let htmlOut = "";
  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--pdf") pdfOut = resolve(args[++i]);
    else if (args[i] === "--html") htmlOut = resolve(args[++i]);
  }

  const { report, contentDir } = await loadReport(reportDir);
  const brand: Brand = { ...DEFAULT_BRAND, ...(report.brand || {}) };

  // Compress diagrams (no-op if dir missing or sips absent)
  await compressDiagrams(reportDir);

  const slug = `${slugify(report.clientName)}-${slugify(report.reportTitle)}-${slugify(report.reportDate)}`;
  if (!pdfOut) pdfOut = join(reportDir, `${slug}.pdf`);
  if (!htmlOut) htmlOut = join(reportDir, `${slug}.html`);

  const html = await buildHtml(report, contentDir);
  await writeFile(htmlOut, html, "utf8");

  await renderPdf(htmlOut, pdfOut, report, brand);

  const [htmlStat, pdfStat] = await Promise.all([stat(htmlOut), stat(pdfOut)]);
  console.log(`HTML: ${htmlOut} (${(htmlStat.size / 1024).toFixed(1)} KB)`);
  console.log(`PDF:  ${pdfOut} (${(pdfStat.size / 1024).toFixed(1)} KB)`);
}

await main();
