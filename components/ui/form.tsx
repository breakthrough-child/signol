import * as React from "react";
import { cn } from "@/lib/utils";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...p }, ref) => (
  <input
    ref={ref}
    className={cn("min-h-11 w-full rounded-lg border border-line bg-card px-3 text-[15px] text-ink placeholder:text-ink2/70 disabled:opacity-60", className)}
    {...p}
  />
));
Input.displayName = "Input";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...p }, ref) => (
  <textarea
    ref={ref}
    className={cn("min-h-24 w-full rounded-lg border border-line bg-card px-3 py-2 text-[15px] leading-relaxed text-ink placeholder:text-ink2/70 disabled:opacity-60", className)}
    {...p}
  />
));
Textarea.displayName = "Textarea";

export function Label({ className, ...p }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("mb-1 block text-sm font-semibold", className)} {...p} />;
}

export function Hint({ className, children, id }: { className?: string; children: React.ReactNode; id?: string }) {
  return (
    <p id={id} className={cn("mt-1 text-[13px] leading-snug text-ink2", className)}>
      {children}
    </p>
  );
}
