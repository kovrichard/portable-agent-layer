import { Switch as SwitchPrimitive } from "radix-ui";
import type * as React from "react";
import { cn } from "../lib/cn";

/** Square, like everything else Industry draws — the knob slides, nothing rounds. */
function Switch({
  className,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "inline-flex h-4 w-7 shrink-0 cursor-pointer items-center border border-divider transition-colors data-[state=checked]:bg-accent data-[state=unchecked]:bg-transparent",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="block size-2.5 transition-transform data-[state=checked]:translate-x-3.5 data-[state=checked]:bg-bg data-[state=unchecked]:translate-x-0.5 data-[state=unchecked]:bg-neutral-500"
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
