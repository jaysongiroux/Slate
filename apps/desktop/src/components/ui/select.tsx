import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "../../lib/utils";
import { nativeFieldBorderedClassName } from "./input";

export type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement> & {
  invalid?: boolean;
};

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, invalid, children, ...props }, ref) => (
    <div className="relative">
      <select
        ref={ref}
        className={cn(
          nativeFieldBorderedClassName,
          "h-9 appearance-none pr-9 text-[0.9rem]",
          "hover:bg-white/[0.05] disabled:cursor-not-allowed disabled:opacity-50",
          invalid &&
            "border-danger/80 focus:border-danger focus:shadow-[0_0_0_3px_rgba(255,156,148,0.2)]",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        size={15}
        className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted"
        aria-hidden
      />
    </div>
  ),
);

Select.displayName = "Select";
