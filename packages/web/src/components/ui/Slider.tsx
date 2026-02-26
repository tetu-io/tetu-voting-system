import type { InputHTMLAttributes } from "react";
import { cn } from "./cn";

export function Slider({ className, type = "range", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input type={type} className={cn("ui-slider", className)} {...props} />;
}
