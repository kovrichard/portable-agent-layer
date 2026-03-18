/**
 * Session Summary — generates graduation promotion reports at session end.
 */

export interface Promotion {
  text: string;
  domain: string;
  from: number;
  to: number;
}

export interface Approaching {
  text: string;
  domain: string;
  confidence: number;
  validations: number;
  needed: number;
}

export function formatGraduationSummary(
  promoted: Promotion[],
  approaching: Approaching[]
): string {
  if (promoted.length === 0 && approaching.length === 0) {
    return "";
  }

  const lines: string[] = [
    "📈 SESSION PROMOTIONS (auto)",
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
  ];

  if (promoted.length > 0) {
    lines.push(`Promoted ${promoted.length} principle${promoted.length > 1 ? "s" : ""}:`);
    for (const p of promoted) {
      const tag = p.to >= 90 ? "✓" : "↑";
      const fromTag = p.from >= 90 ? "CRYSTAL" : `${p.from}%`;
      const toTag = p.to >= 90 ? "CRYSTAL" : `${p.to}%`;
      lines.push(`  ${tag} "${p.text.slice(0, 80)}"`);
      lines.push(`    [${fromTag}] → [${toTag}]`);
    }
    lines.push("");
  }

  if (approaching.length > 0) {
    const sorted = approaching
      .filter((a) => a.validations >= 1)
      .sort((a, b) => b.validations - a.validations)
      .slice(0, 5);

    if (sorted.length > 0) {
      lines.push(
        `${approaching.length} principle${approaching.length > 1 ? "s" : ""} approaching promotion:`
      );
      for (const a of sorted) {
        lines.push(`  • "${a.text.slice(0, 60)}"`);
        lines.push(
          `    [${a.confidence}%] → [${a.confidence === 70 ? 85 : 90}%] pending (${a.validations}/${a.validations + a.needed})`
        );
      }
    }
  }

  lines.push("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  return lines.join("\n");
}

export function formatManualCrystallization(text: string, domain: string): string {
  return [
    "💎 MANUAL CRYSTALLIZATION",
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    `✓ "${text.slice(0, 100)}"`,
    `  Domain: ${domain}`,
    "  [confidence: 70%] → [CRYSTAL: 90%]",
    "  (manual override - bypassed validation)",
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
  ].join("\n");
}
