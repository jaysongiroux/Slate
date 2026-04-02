import * as React from "react";
import { cn } from "../../lib/utils";

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "ghost" | "secondary" | "danger" | "primary";
  size?: "sm" | "md" | "icon";
};

const variantClass: Record<NonNullable<ButtonProps["variant"]>, string> = {
  ghost: "bg-transparent hover:bg-white/[0.06]",
  secondary: "bg-white/[0.08] font-medium hover:bg-white/[0.12]",
  primary: "bg-white/[0.12] font-medium hover:bg-white/[0.18] disabled:opacity-50",
  danger: "bg-transparent text-danger hover:bg-white/[0.06]",
};

const sizeClass: Record<NonNullable<ButtonProps["size"]>, string> = {
  md: "h-[38px] gap-2 rounded-xl px-3.5",
  sm: "h-8 gap-2 rounded-xl px-2.5",
  icon: "size-[34px] gap-2 rounded-xl p-0",
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "ghost", size = "md", type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(
        "inline-flex cursor-pointer items-center justify-center transition-[background-color,color] duration-150 ease-out [-webkit-app-region:no-drag] disabled:pointer-events-none disabled:opacity-50",
        variantClass[variant],
        sizeClass[size],
        className,
      )}
      {...props}
    />
  ),
);

Button.displayName = "Button";
