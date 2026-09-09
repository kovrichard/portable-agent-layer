import { ToggleGroup as ToggleGroupPrimitive } from "radix-ui";
import type * as React from "react";
import { cn } from "../lib/cn";

/** Industry's segmented control: one hairline box, hairline rules between options. */
function ToggleGroup({
  className,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Root>) {
  return (
    <ToggleGroupPrimitive.Root
      data-slot="toggle-group"
      className={cn(
        "flex items-stretch border border-divider text-[11px] leading-none",
        className
      )}
      {...props}
    />
  );
}

function ToggleGroupItem({
  className,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Item>) {
  return (
    <ToggleGroupPrimitive.Item
      data-slot="toggle-group-item"
      className={cn(
        "cursor-pointer border-l border-divider bg-transparent px-3 py-2 text-ink transition-colors first:border-l-0 hover:bg-neutral-200 data-[state=on]:bg-accent data-[state=on]:text-bg",
        className
      )}
      {...props}
    />
  );
}

export { ToggleGroup, ToggleGroupItem };
