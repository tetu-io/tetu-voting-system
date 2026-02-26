import type { ReactNode } from "react";
import { cn } from "./cn";

type ModalProps = {
  open: boolean;
  children: ReactNode;
  wide?: boolean;
  onOverlayClick?: () => void;
};

export function Modal({ open, children, wide = false, onOverlayClick }: ModalProps) {
  if (!open) return null;
  return (
    <div role="dialog" className="ui-modal-overlay" onClick={onOverlayClick}>
      <div className={cn("ui-modal", wide && "ui-modal--wide")} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}
