import * as React from "react";
import { cn } from "../../lib/utils";

export function Separator({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden="true" className={cn("h-px bg-border-soft", className)} {...props} />;
}
