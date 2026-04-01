import * as React from "react";
import { cn } from "../../lib/utils";

/** Native `<input>` / `<select>` chrome for settings-style forms (Milkdown stays on plain CSS). */
export const nativeFieldBorderedClassName =
  "w-full rounded-[10px] border border-border bg-white/[0.04] px-3 py-2.5 text-foreground outline-none transition-[border-color,box-shadow] duration-150 ease-out focus:border-white/20";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  variant?: "plain" | "bordered";
  invalid?: boolean;
};

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, variant = "plain", invalid, "aria-invalid": ariaInvalidProp, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "w-full bg-transparent outline-none",
        variant === "bordered" &&
          cn(
            nativeFieldBorderedClassName,
            invalid &&
              "border-danger/80 focus:border-danger focus:shadow-[0_0_0_3px_rgba(255,156,148,0.2)]",
          ),
        className,
      )}
      aria-invalid={invalid ?? ariaInvalidProp}
      {...props}
    />
  ),
);

Input.displayName = "Input";
