import { useId, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation("game");
  return (
    <div className="dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="dialog-card">
        {showClose && (
          <button type="button" className="dialog-close" aria-label={t("close")} onClick={onClose}>
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
