import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "../../lib/utils"

const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-2 whitespace-nowrap",
    "rounded-lg text-sm font-medium",
    "transition-all duration-300 ease-in-out",
    "focus-visible:outline-none focus-visible:ring-2",
    "focus-visible:ring-[#137B78] focus-visible:ring-offset-2",
    "focus-visible:ring-offset-white dark:focus-visible:ring-offset-gray-900",
    "disabled:pointer-events-none disabled:opacity-50",
    "active:scale-[0.97]",
    "[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  ].join(" "),
  {
    variants: {
      variant: {
        default:
          "bg-[#137B78] text-white shadow-sm hover:bg-[#106663] hover:shadow-md",

        destructive:
          "bg-red-600 text-white shadow-sm hover:bg-red-700 hover:shadow-md",

        outline:
          "border border-gray-200 bg-white text-[#137B78] shadow-sm " +
          "hover:border-[#137B78]/40 hover:bg-[#137B78]/5 hover:shadow-md " +
          "dark:border-gray-700 dark:bg-gray-900 dark:text-[#65C5BF] " +
          "dark:hover:border-[#65C5BF]/40 dark:hover:bg-[#137B78]/15",

        secondary:
          "bg-gray-100 text-gray-700 shadow-sm hover:bg-[#137B78]/10 " +
          "hover:text-[#137B78] hover:shadow-md " +
          "dark:bg-gray-800 dark:text-gray-300 " +
          "dark:hover:bg-[#137B78]/20 dark:hover:text-[#65C5BF]",

        ghost:
          "text-gray-700 hover:bg-[#137B78]/10 hover:text-[#137B78] " +
          "dark:text-gray-300 dark:hover:bg-[#137B78]/20 " +
          "dark:hover:text-[#65C5BF]",

        link:
          "text-[#137B78] underline-offset-4 hover:underline " +
          "dark:text-[#65C5BF]",

        success:
          "bg-[#137B78] text-white shadow-sm hover:bg-[#106663] hover:shadow-md",

        warning:
          "bg-yellow-600 text-white shadow-sm hover:bg-yellow-700 hover:shadow-md",
      },

      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-11 rounded-lg px-8 text-base",
        icon: "h-9 w-9",
        xl: "h-12 rounded-lg px-10 text-base",
      },
    },

    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"

    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size, className }))}
        {...props}
      />
    )
  }
)

Button.displayName = "Button"

export { Button, buttonVariants }