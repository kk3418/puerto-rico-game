import { useId, type ReactNode } from "react";

export function Tooltip({
  content,
  children,
  className = "",
}: {
  content: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const id = useId();
  return (
    <span className={`tooltip ${className}`.trim()} tabIndex={0} aria-describedby={id}>
      {children}
      <span id={id} className="tooltip-content" role="tooltip">
        {content}
      </span>
    </span>
  );
}
