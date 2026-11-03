import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50 min-h-11 px-4 cursor-pointer",
  {
    variants: {
      variant: {
        default: "bg-signal text-signalink hover:brightness-110 shadow-sm",
        ink: "bg-ink text-paper hover:opacity-90",
        outline: "border border-line bg-card text-ink hover:bg-paper2",
        ghost: "text-ink hover:bg-paper2",
        danger: "bg-against text-signalink hover:brightness-110",
      },
      size: { default: "", sm: "min-h-9 px-3 text-[13px]", lg: "min-h-12 px-6 text-base" },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, ...props }, ref) => (
  <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
));
Button.displayName = "Button";
export { buttonVariants };
