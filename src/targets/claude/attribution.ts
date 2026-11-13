import { PAL_REPO_URL } from "../../hooks/lib/remote";
import type { Settings } from "../settings-merge";

/**
 * Build the commit footer (bare URL, autolinks on GitHub) and PR body line
 * (markdown link). `sessionUrl` is off because Claude Code otherwise appends a
 * claude.ai session link to commits made from web or Remote Control sessions,
 * which puts a link to a private transcript in a public history.
 */
export function buildAttributionText(
  name: string,
  repoUrl: string = PAL_REPO_URL
): { commit: string; pr: string; sessionUrl: false } {
  return {
    commit: `Co-authored by ${name} · ${repoUrl}`,
    pr: `Co-authored by [${name}](${repoUrl})`,
    sessionUrl: false,
  };
}

/**
 * Apply the user's git-attribution choice to a Claude settings object.
 * Enabled → fill attribution.commit/pr and drop Claude's own byline (includeCoAuthoredBy:false).
 * Disabled → clear PAL attribution and restore Claude's default byline.
 */
export function applyAttribution(
  settings: Settings,
  opts: { enabled: boolean; name: string; repoUrl?: string }
): Settings {
  const result = { ...settings };

  if (opts.enabled) {
    result.attribution = buildAttributionText(opts.name, opts.repoUrl);
    result.includeCoAuthoredBy = false;
  } else {
    result.attribution = { commit: "", pr: "", sessionUrl: false };

    if (result.includeCoAuthoredBy === false) delete result.includeCoAuthoredBy;
  }

  return result;
}
