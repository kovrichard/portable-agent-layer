import { Label as LabelPrimitive } from "radix-ui";
import type * as React from "react";
import { cn } from "../lib/cn";

function Label({
  className,
  ...props
}: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn("eyebrow flex items-center gap-2 select-none", className)}
      {...props}
    />
  );
}

export { Label };
