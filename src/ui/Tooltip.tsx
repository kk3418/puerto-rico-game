import { useId, type ReactNode } from "react";

export function Tooltip({ content, children }: { content: ReactNode; children: ReactNode }) {
  const id = useId();
  return (
    <span className="tooltip" tabIndex={0} aria-describedby={id}>
      {children}
      <span id={id} className="tooltip-content" role="tooltip">
        {content}
      </span>
    </span>
  );
}
