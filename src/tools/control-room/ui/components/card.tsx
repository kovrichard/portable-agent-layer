import type * as React from "react";
import { cn } from "../lib/cn";

/** Industry's card is the blueprint object: square, hairline, unfilled, marked. */
function Card({ className, ...props }: React.ComponentProps<"section">) {
  return (
    <section
      data-slot="card"
      className={cn("blueprint flex flex-col bg-bg p-4", className)}
      {...props}
    />
  );
}

function CardHeader({ className, ...props }: React.ComponentProps<"header">) {
  return (
    <header
      data-slot="card-header"
      className={cn("mb-3 flex items-baseline justify-between gap-3", className)}
      {...props}
    />
  );
}

function CardTitle({ className, ...props }: React.ComponentProps<"h2">) {
  return (
    <h2 data-slot="card-title" className={cn("eyebrow m-0", className)} {...props} />
  );
}

function CardAction({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="card-action"
      className={cn("text-[11px] text-neutral-600", className)}
      {...props}
    />
  );
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card-content" className={cn(className)} {...props} />;
}

export { Card, CardAction, CardContent, CardHeader, CardTitle };
