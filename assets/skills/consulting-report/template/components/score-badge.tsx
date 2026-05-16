import type { CSSProperties } from "react";

// Default 5-step ramp (red → green). For score badges we use slightly more
// saturated background/border colors than RubricTable's underline ramp.
const DEFAULT_STEPS: { color: string; bg: string; border: string }[] = [
  { color: "#dc2626", bg: "rgba(220,38,38,0.12)", border: "rgba(220,38,38,0.40)" }, // 1
  { color: "#ea580c", bg: "rgba(234,88,12,0.12)", border: "rgba(234,88,12,0.35)" }, // 2
  { color: "#d97706", bg: "rgba(217,119,6,0.12)", border: "rgba(217,119,6,0.35)" }, // 3
  { color: "#4d7c0f", bg: "rgba(132,204,22,0.14)", border: "rgba(132,204,22,0.40)" }, // 4
  { color: "#16a34a", bg: "rgba(22,163,74,0.12)", border: "rgba(22,163,74,0.35)" }, // 5
];

interface ScoreBadgeProps {
  score: number;
  /**
   * Maximum possible score on the rubric this badge sits on. Used to map
   * the score onto the color ramp. Defaults to 5.
   */
  maxScore?: number;
  /** Optional palette override. Length-independent (entries are sampled). */
  palette?: { color: string; bg: string; border: string }[];
}

function step(score: number, maxScore: number, palette: typeof DEFAULT_STEPS) {
  if (maxScore <= 1) return palette[palette.length - 1];
  const clamped = Math.max(1, Math.min(score, maxScore));
  const t = (clamped - 1) / (maxScore - 1);
  const idx = Math.round(t * (palette.length - 1));
  return palette[idx];
}

export function ScoreBadge({ score, maxScore = 5, palette = DEFAULT_STEPS }: ScoreBadgeProps) {
  const s = step(score, maxScore, palette);
  const style: CSSProperties = {
    color: s.color,
    background: s.bg,
    borderColor: s.border,
  };
  return (
    <span
      className="inline-flex items-center justify-center min-w-7 h-7 px-2 rounded-md font-sans text-sm font-bold border border-transparent"
      style={style}
    >
      {score}
    </span>
  );
}
