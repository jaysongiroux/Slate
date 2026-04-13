import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "../../lib/utils";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({
  className,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal>
      <div className="fixed inset-0 z-[100]">
        <DialogPrimitive.Overlay
          className={cn(
            "slate-dialog-overlay pointer-events-auto absolute inset-0",
            "data-[state=open]:animate-[slate-dialog-overlay-in_180ms_ease-out]",
            "data-[state=closed]:animate-[slate-dialog-overlay-out_150ms_ease-in]",
          )}
        />
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-4">
          <DialogPrimitive.Content
            className={cn(
              "slate-dialog-content-surface relative z-10 w-[min(480px,calc(100vw-32px))] max-h-[min(calc(100vh-32px),900px)] overflow-y-auto rounded-[24px] px-[22px] pt-[22px] pb-5 [-webkit-app-region:no-drag] pointer-events-auto",
              "origin-center",
              "data-[state=open]:animate-[slate-dialog-content-in_180ms_ease-out]",
              "data-[state=closed]:animate-[slate-dialog-content-out_150ms_ease-in]",
              className,
            )}
            {...props}
          >
            {children}
            <DialogPrimitive.Close
              className="slate-dialog-close absolute top-3.5 right-3.5 inline-flex size-[30px] cursor-pointer items-center justify-center rounded-full text-faint transition-[background-color,color,border-color,transform] duration-150 hover:text-foreground"
              aria-label="Close"
            >
              <X size={16} />
            </DialogPrimitive.Close>
          </DialogPrimitive.Content>
        </div>
      </div>
    </DialogPrimitive.Portal>
  );
}

export function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("slate-dialog-header mb-[12px] flex flex-col gap-1.5", className)}
      {...props}
    />
  );
}

export function DialogTitle({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title className={cn("m-0 text-[1.12rem] font-bold", className)} {...props} />
  );
}

export function DialogDescription({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      className={cn("m-0 text-[0.92rem] leading-normal text-muted", className)}
      {...props}
    />
  );
}
