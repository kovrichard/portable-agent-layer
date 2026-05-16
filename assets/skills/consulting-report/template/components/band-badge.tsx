// Generic band badge. The set of band labels is not pinned by the template —
// projects pass any string. A default style map covers the strategic-bet
// "Strong/Promising/Park/Decline" vocabulary out of the box; projects can
// supply their own via `bandStyles`.

import type { CSSProperties } from "react";

export type BandStyle = {
  color: string;
  background: string;
  borderColor: string;
};

const defaultBandStyles: Record<string, BandStyle> = {
  Strong: {
    color: "var(--color-success)",
    background: "rgba(22,163,74,0.12)",
    borderColor: "rgba(22,163,74,0.4)",
  },
  Promising: {
    color: "var(--color-primary)",
    background: "rgba(29,78,216,0.10)",
    borderColor: "rgba(29,78,216,0.35)",
  },
  Park: {
    color: "var(--color-muted)",
    background: "rgba(100,116,139,0.12)",
    borderColor: "rgba(100,116,139,0.35)",
  },
  Decline: {
    color: "var(--color-destructive)",
    background: "rgba(220,38,38,0.10)",
    borderColor: "rgba(220,38,38,0.35)",
  },
};

interface BandBadgeProps {
  band: string;
  /**
   * Override or extend the default band styles. Keys are band labels; values
   * are the visual treatment. Falls back to a neutral style when a band
   * label is not found in either the override map or the defaults.
   */
  bandStyles?: Record<string, BandStyle>;
}

const fallbackStyle: BandStyle = {
  color: "var(--color-muted)",
  background: "rgba(100,116,139,0.10)",
  borderColor: "rgba(100,116,139,0.30)",
};

function resolveStyle(band: string, override?: Record<string, BandStyle>): BandStyle {
  return override?.[band] ?? defaultBandStyles[band] ?? fallbackStyle;
}

export function BandBadge({ band, bandStyles }: BandBadgeProps) {
  const s = resolveStyle(band, bandStyles);
  const style: CSSProperties = {
    color: s.color,
    background: s.background,
    borderColor: s.borderColor,
  };
  return (
    <span
      className="inline-flex items-center px-2.5 py-0.5 rounded-full font-sans text-[0.7rem] font-bold uppercase tracking-widest border whitespace-nowrap"
      style={style}
    >
      {band}
    </span>
  );
}
