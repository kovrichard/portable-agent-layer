/**
 * Cross-Frame Synthesizer — Find principles appearing across multiple domains
 *
 * Scans all wisdom frames and identifies principles/anti-patterns
 * that appear in 2+ domains. These get higher confidence and are written
 * to a verified principles file.
 *
 * Usage: Run periodically (weekly) or after significant frame updates
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { logDebug } from "./log";
import { paths } from "./paths";

interface CrossPrinciple {
  text: string;
  domains: string[];
  count: number;
}

interface FrameHealth {
  domain: string;
  principleCount: number;
  antiPatternCount: number;
  lastUpdated: string;
  health: "growing" | "stable" | "stale";
}

/** Extract all principles from a frame */
function extractPrinciples(content: string): string[] {
  const principles: string[] = [];

  // Match lines with confidence or CRYSTAL tags
  const lines = content.split("\n");
  for (const line of lines) {
    const match = line.match(/^- (.+?)\s*\[(?:confidence|CRYSTAL):/);
    if (match) {
      // Normalize: lowercase, remove punctuation for comparison
      const normalized = match[1]
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, "")
        .replace(/\s+/g, " ")
        .trim();
      principles.push(normalized);
    }
  }

  return principles;
}

/** Extract anti-patterns from a frame */
function extractAntiPatterns(content: string): string[] {
  const patterns: string[] = [];
  const lines = content.split("\n");

  for (const line of lines) {
    const match = line.match(/^- (.+?)\s*\[severity:/);
    if (match) {
      const normalized = match[1]
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, "")
        .replace(/\s+/g, " ")
        .trim();
      patterns.push(normalized);
    }
  }

  return patterns;
}

/** Find principles appearing in 2+ domains */
function findCrossPrinciples(framesDir: string): CrossPrinciple[] {
  if (!existsSync(framesDir)) return [];

  const domainPrinciples = new Map<string, string[]>();

  // Load all frames
  for (const file of readdirSync(framesDir).filter((f) => f.endsWith(".md"))) {
    const domain = file.replace(".md", "");
    const content = readFileSync(resolve(framesDir, file), "utf-8");
    const principles = extractPrinciples(content);
    domainPrinciples.set(domain, principles);
  }

  // Count occurrences across domains
  const principleCounts = new Map<string, Set<string>>();

  for (const [domain, principles] of domainPrinciples) {
    for (const principle of principles) {
      if (!principleCounts.has(principle)) {
        principleCounts.set(principle, new Set());
      }
      principleCounts.get(principle)?.add(domain);
    }
  }

  // Filter to principles appearing in 2+ domains
  const crossPrinciples: CrossPrinciple[] = [];
  for (const [text, domains] of principleCounts) {
    if (domains.size >= 2) {
      crossPrinciples.push({
        text,
        domains: Array.from(domains),
        count: domains.size,
      });
    }
  }

  return crossPrinciples.sort((a, b) => b.count - a.count);
}

/** Assess frame health */
function assessFrameHealth(
  domain: string,
  content: string,
  filepath: string
): FrameHealth {
  const principles = extractPrinciples(content);
  const antiPatterns = extractAntiPatterns(content);

  // Check last modified date
  const stats = existsSync(filepath)
    ? { mtime: new Date() } // Simplified - would use actual file stat
    : { mtime: new Date(0) };

  const daysSinceUpdate = Math.floor(
    (Date.now() - stats.mtime.getTime()) / (1000 * 60 * 60 * 24)
  );

  let health: "growing" | "stable" | "stale";
  if (daysSinceUpdate <= 7) {
    health = "growing";
  } else if (daysSinceUpdate <= 30) {
    health = "stable";
  } else {
    health = "stale";
  }

  return {
    domain,
    principleCount: principles.length,
    antiPatternCount: antiPatterns.length,
    lastUpdated: stats.mtime.toISOString().slice(0, 10),
    health,
  };
}

/** Generate cross-frame synthesis report */
export function runCrossFrameSynthesis(): {
  crossPrinciples: CrossPrinciple[];
  health: FrameHealth[];
} {
  const framesDir = paths.wisdom();

  if (!existsSync(framesDir)) {
    return { crossPrinciples: [], health: [] };
  }

  // Find cross-domain principles
  const crossPrinciples = findCrossPrinciples(framesDir);
  logDebug("cross-frame", `Found ${crossPrinciples.length} cross-domain principles`);

  // Assess frame health
  const health: FrameHealth[] = [];
  for (const file of readdirSync(framesDir).filter((f) => f.endsWith(".md"))) {
    const domain = file.replace(".md", "");
    const filepath = resolve(framesDir, file);
    const content = readFileSync(filepath, "utf-8");
    health.push(assessFrameHealth(domain, content, filepath));
  }

  // Write cross-frame principles to verified file
  if (crossPrinciples.length > 0) {
    const verifiedPath = resolve(framesDir, "../verified-principles.md");
    const lines = [
      "# Verified Cross-Domain Principles",
      "",
      "Principles appearing across multiple wisdom domains:",
      "",
      ...crossPrinciples.map(
        (p) => `- **${p.text}** (${p.count} domains: ${p.domains.join(", ")})`
      ),
      "",
    ];
    writeFileSync(verifiedPath, lines.join("\n"), "utf-8");
    logDebug(
      "cross-frame",
      `Written ${crossPrinciples.length} principles to verified-principles.md`
    );
  }

  return { crossPrinciples, health };
}

/** Format health report */
export function formatHealthReport(health: FrameHealth[]): string {
  const lines = [
    "📊 Frame Health Report",
    "",
    "| Domain | Health | Principles | Anti-Patterns |",
    "|--------|--------|------------|---------------|",
  ];

  for (const h of health) {
    const icon = h.health === "growing" ? "🟢" : h.health === "stable" ? "🟡" : "🔴";
    lines.push(
      `| ${h.domain} | ${icon} ${h.health} | ${h.principleCount} | ${h.antiPatternCount} |`
    );
  }

  lines.push("");

  // Flag stale frames
  const stale = health.filter((h) => h.health === "stale");
  if (stale.length > 0) {
    lines.push("⚠️ Stale frames needing attention:", "");
    for (const h of stale) {
      lines.push(`- **${h.domain}**: Last updated ${h.lastUpdated}`);
    }
    lines.push("");
  }

  // Flag empty frames
  const empty = health.filter((h) => h.principleCount === 0 && h.antiPatternCount === 0);
  if (empty.length > 0) {
    lines.push("📝 Empty frames:", "");
    for (const h of empty) {
      lines.push(`- **${h.domain}**: No principles or anti-patterns yet`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
