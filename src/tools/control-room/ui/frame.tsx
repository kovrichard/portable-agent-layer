import type { ReactNode } from "react";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "./components/card";
import { Skeleton } from "./components/skeleton";
import { ToggleGroup, ToggleGroupItem } from "./components/toggle-group";
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
    <Card className={className}>
      {title && (
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          {aside && <CardAction>{aside}</CardAction>}
        </CardHeader>
      )}
      <CardContent>{children}</CardContent>
    </Card>
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
    <ToggleGroup
      type="single"
      aria-label={label}
      value={value}
      onValueChange={(next) => next && onPick(next as T)}
    >
      {options.map((option) => (
        <ToggleGroupItem key={option.value} value={option.value}>
          {option.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
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
    return (
      <div className="flex flex-col gap-1.5 py-2">
        <span className="sr-only">reading</span>
        <Skeleton className="h-3 w-2/5" />
        <Skeleton className="h-3 w-3/5" />
        <Skeleton className="h-3 w-1/3" />
      </div>
    );
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
