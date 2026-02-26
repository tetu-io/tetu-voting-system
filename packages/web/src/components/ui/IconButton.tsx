import type { ButtonHTMLAttributes } from "react";
import { cn } from "./cn";

export function IconButton({ className, type = "button", ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type={type} className={cn("ui-icon-btn", className)} {...props} />;
}
