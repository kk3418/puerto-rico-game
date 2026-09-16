import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

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
  const triggerRef = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number; place: "top" | "bottom" } | null>(null);

  function updatePosition() {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const place = rect.top < 160 ? "bottom" : "top";
    const min = 140;
    const left = Math.min(Math.max(rect.left + rect.width / 2, min), window.innerWidth - min);
    setCoords({
      top: place === "top" ? rect.top : rect.bottom,
      left,
      place,
    });
  }

  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
    function onMove() {
      updatePosition();
    }
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [open]);

  return (
    <span
      ref={triggerRef}
      className={`tooltip ${className}`.trim()}
      tabIndex={0}
      aria-describedby={open ? id : undefined}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {children}
      {open &&
        coords &&
        createPortal(
          <span
            id={id}
            role="tooltip"
            className={`tooltip-content is-open tooltip-${coords.place}`}
            style={{ top: coords.top, left: coords.left }}
          >
            {content}
          </span>,
          document.body,
        )}
    </span>
  );
}
