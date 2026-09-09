import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type * as React from "react";
import { cn } from "../lib/cn";

const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center justify-center gap-1 rounded-none border border-transparent px-2 py-0.5 text-[10px] whitespace-nowrap [&>svg]:size-3",
  {
    variants: {
      variant: {
        accent: "bg-accent-100 text-accent-900",
        neutral: "bg-neutral-200 text-neutral-800",
        outline: "border-divider text-neutral-700",
        alarm: "border-alarm/40 bg-alarm/10 text-alarm",
      },
    },
    defaultVariants: { variant: "neutral" },
  }
);

function Badge({
  className,
  variant,
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span";
  return (
    <Comp
      data-slot="badge"
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
}

export { Badge };
