import type * as React from "react";
import { cn } from "../lib/cn";

const FIELD =
  "h-8 rounded-none border border-divider bg-bg px-2 text-[12px] text-ink outline-none transition-colors focus-visible:border-accent disabled:pointer-events-none disabled:opacity-45";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input type={type} data-slot="input" className={cn(FIELD, className)} {...props} />
  );
}

/** Industry's forms are native controls; catalyst does the same rather than wrap Radix Select. */
function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      data-slot="native-select"
      className={cn(FIELD, "cursor-pointer", className)}
      {...props}
    />
  );
}

export { Input, NativeSelect };
