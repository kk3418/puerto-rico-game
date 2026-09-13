import { useId, type ReactNode } from "react";
import "./Dialog.css";

export function Dialog({
  title,
  children,
  actions,
}: {
  title: string;
  children?: ReactNode;
  actions: ReactNode;
}) {
  const titleId = useId();
  return (
    <div className="dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="dialog-card">
        <h2 id={titleId}>{title}</h2>
        {children}
        <div className="dialog-actions">{actions}</div>
      </div>
    </div>
  );
}
