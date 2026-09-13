import { useId, type ReactNode } from "react";
import "./Dialog.css";

export function Dialog({
  title,
  children,
  actions,
  showClose = false,
  onClose,
}: {
  title: string;
  children?: ReactNode;
  actions: ReactNode;
  showClose?: boolean;
  onClose?: () => void;
}) {
  const titleId = useId();
  return (
    <div className="dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="dialog-card">
        {showClose && (
          <button type="button" className="dialog-close" aria-label="關閉" onClick={onClose}>
            ×
          </button>
        )}
        <h2 id={titleId}>{title}</h2>
        {children}
        <div className="dialog-actions">{actions}</div>
      </div>
    </div>
  );
}
