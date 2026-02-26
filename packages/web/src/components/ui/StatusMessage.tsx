import type { HTMLAttributes } from "react";
import { cn } from "./cn";

type StatusTone = "info" | "success" | "warning" | "error";

type StatusMessageProps = HTMLAttributes<HTMLDivElement> & {
  tone?: StatusTone;
};

export function StatusMessage({ className, tone = "info", ...props }: StatusMessageProps) {
  return <div className={cn("ui-status", `ui-status--${tone}`, className)} {...props} />;
}
