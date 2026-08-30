"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Checkbox-backed toggle. Renders a real <input type="checkbox"> (form-native,
 * keyboard-accessible) visually styled as a switch.
 */
export interface SwitchProps
  extends Omit<React.ComponentProps<"input">, "type" | "role"> {
  label?: string;
}

const Switch = React.forwardRef<HTMLInputElement, SwitchProps>(
  ({ className, label, ...props }, ref) => (
    <label className={cn("inline-flex cursor-pointer items-center gap-2", className)}>
      <span className="relative inline-flex h-6 w-11 shrink-0 items-center">
        <input
          ref={ref}
          type="checkbox"
          className="peer sr-only"
          {...props}
        />
        <span className="absolute inset-0 rounded-full bg-input transition-colors peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2" />
        <span className="absolute left-0.5 h-5 w-5 rounded-full bg-background shadow transition-transform peer-checked:translate-x-5" />
      </span>
      {label && <span className="text-sm">{label}</span>}
    </label>
  ),
);
Switch.displayName = "Switch";

export { Switch };
