import type { ReactNode } from "react";
import type { Loaded } from "./lib/api";
import { cn } from "./lib/cn";

export function Panel({
  title,
  aside,
  className,
  children,
}: {
  title?: string;
  aside?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={cn("blueprint bg-bg p-4", className)}>
      {title && (
        <header className="mb-3 flex items-baseline justify-between gap-3">
          <h6 className="eyebrow m-0">{title}</h6>
          {aside && <span className="text-[11px] text-neutral-600">{aside}</span>}
        </header>
      )}
      {children}
    </section>
  );
}

const TONES = {
  accent: "bg-accent-100 text-accent-900",
  neutral: "bg-neutral-200 text-neutral-800",
  outline: "border border-divider text-neutral-700",
  alarm: "bg-alarm/10 text-alarm border border-alarm/40",
} as const;

export function Tag({
  tone = "neutral",
  title,
  children,
}: {
  tone?: keyof typeof TONES;
  title?: string;
  children: ReactNode;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-block px-2 py-0.5 text-[10px] whitespace-nowrap",
        TONES[tone]
      )}
    >
      {children}
    </span>
  );
}

export interface SegOption<T extends string> {
  value: T;
  label: string;
}

export function Seg<T extends string>({
  options,
  value,
  onPick,
  label,
}: {
  options: readonly SegOption<T>[];
  value: T;
  onPick: (next: T) => void;
  label: string;
}) {
  return (
    <fieldset className="flex border border-divider text-[11px] leading-none">
      <legend className="sr-only">{label}</legend>
      {options.map((option) => (
        <button
          type="button"
          key={option.value}
          onClick={() => onPick(option.value)}
          className={cn(
            "cursor-pointer border-l border-divider px-3 py-2 first:border-l-0",
            option.value === value
              ? "bg-accent text-bg"
              : "bg-transparent text-ink hover:bg-neutral-200"
          )}
        >
          {option.label}
        </button>
      ))}
    </fieldset>
  );
}

/**
 * A screen whose frame stays put: the title and whatever toolbar it carries
 * hold their place, and only `children` scrolls. Children are handed a region
 * that is already the right height, so a table inside it scrolls its own rows
 * rather than the window.
 */
export function Screen({
  title,
  aside,
  toolbar,
  children,
}: {
  title: string;
  aside?: ReactNode;
  toolbar?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="m-0 text-[34px]">{title}</h1>
        {aside}
      </div>
      {toolbar}
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </div>
  );
}

/** The scroll region itself — one per screen, and the only thing that moves. */
export function Scroller({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return <div className={cn("min-h-0 flex-1 overflow-auto", className)}>{children}</div>;
}

export function Pending({ value }: { value: Loaded<unknown> }) {
  if (value.state === "loading")
    return <div className="py-2 text-[12px] text-neutral-500">reading…</div>;
  if (value.state === "error")
    return (
      <div className="border-l-2 border-alarm bg-alarm/10 px-3 py-2 text-[12px] text-alarm">
        {value.message}
      </div>
    );
  return null;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="py-2 text-[12px] text-neutral-500">{children}</div>;
}
