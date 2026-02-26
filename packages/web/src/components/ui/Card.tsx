import type { HTMLAttributes } from "react";
import { cn } from "./cn";

type CardSurface = "plate" | "dark";

type CardProps = HTMLAttributes<HTMLDivElement> & {
  surface?: CardSurface;
  active?: boolean;
};

export function Card({ className, surface = "plate", active = false, ...props }: CardProps) {
  return <div className={cn("ui-card", surface === "dark" && "ui-card--dark", active && "ui-card--active", className)} {...props} />;
}
