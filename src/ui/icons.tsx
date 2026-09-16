import type { Good, Role, TileType } from "../engine/types";

export type IconKind = Good | TileType | Role | "coin" | "vp" | "colonist" | "ship" | "governor";

export function GameIcon({
  kind,
  label,
  size = 18,
}: {
  kind: IconKind;
  label?: string;
  size?: number;
}) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    className: `game-icon icon-${kind}`,
    role: label ? ("img" as const) : undefined,
    "aria-label": label,
    "aria-hidden": label ? undefined : (true as const),
  };

  if (kind === "coin") {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="9" fill="#e5b940" stroke="#ffe69a" strokeWidth="1.5" />
        <path d="M14.8 8.3c-.7-.7-1.7-1.1-2.8-1.1-1.7 0-3 .8-3 2.1 0 3.2 6.1 1.4 6.1 4.8 0 1.5-1.3 2.6-3.2 2.6-1.3 0-2.6-.5-3.4-1.4M12 5.5v13" fill="none" stroke="#7b4a12" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    );
  }
  if (kind === "vp") {
    return (
      <svg {...common}>
        <path d="M12 2.5l2.6 5.2 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z" fill="#f3d777" stroke="#fff0ae" strokeWidth="1.2" />
        <text x="12" y="13.5" textAnchor="middle" fontSize="7" fontWeight="900" fill="#754018">VP</text>
      </svg>
    );
  }
  if (kind === "colonist") {
    return (
      <svg {...common}>
        <circle cx="12" cy="7" r="3.2" fill="#ead6b7" />
        <path d="M6.2 20c.4-5.1 2.2-8.3 5.8-8.3s5.4 3.2 5.8 8.3z" fill="#9a3628" stroke="#f0c8a8" strokeWidth="1" />
      </svg>
    );
  }
  if (kind === "ship") {
    return (
      <svg {...common}>
        <path d="M5 5h8v8H5zM13 7l5 4h-5z" fill="#f3e2b6" />
        <path d="M2.5 14h19l-3.7 6H7z" fill="#9b542c" stroke="#f0c98a" strokeWidth="1.2" />
      </svg>
    );
  }
  if (kind === "governor") {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="10.2" fill="#f0c938" stroke="#fff6c8" strokeWidth="1.8" />
        <path
          d="M3.1 14.6C5.6 7.6 8.8 5 12 5s6.4 2.6 8.9 9.6c-2.7-1.7-5.7-2.5-8.9-2.5s-6.2.8-8.9 2.5z"
          fill="#6b3e22"
          stroke="#3b2011"
          strokeWidth="1.1"
        />
        <path d="M7.4 12.4c1.2-3.2 2.8-4.6 4.6-4.6s3.4 1.4 4.6 4.6" fill="#8c5a28" />
        <path d="M12 5.2v3.1" stroke="#f6e3b0" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="12" cy="16.4" r="1.15" fill="#fff0ae" />
      </svg>
    );
  }
  if (kind === "quarry") {
    return (
      <svg {...common}>
        <path d="M3 18l4.7-7 3 2.3L15.5 6 21 18z" fill="#91979a" stroke="#d7dcdb" strokeWidth="1.2" />
        <path d="M7.7 11l4.1 7M15.5 6l1.1 12" stroke="#646b6e" strokeWidth="1" />
      </svg>
    );
  }
  if (kind === "corn") {
    return (
      <svg {...common}>
        <path d="M12 4c4 2.7 4.2 10.7 0 16-4.2-5.3-4-13.3 0-16z" fill="#f0c938" />
        <path d="M8.7 9.2c-3 2.5-3.1 6.7.9 9.8M15.3 9.2c3 2.5 3.1 6.7-.9 9.8" fill="#64a34a" stroke="#b8d36b" strokeWidth="1.2" />
        <path d="M10 8h4M9.5 11h5M10 14h4" stroke="#9d7021" strokeWidth="1" />
      </svg>
    );
  }
  if (kind === "indigo") {
    return (
      <svg {...common}>
        <path d="M12 3C8 8 6 11.3 6 15a6 6 0 0012 0c0-3.7-2-7-6-12z" fill="#4560a2" stroke="#aebbe8" strokeWidth="1.2" />
        <path d="M9 16c.5 1.5 1.5 2.2 3 2.3" fill="none" stroke="#dbe2ff" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
    );
  }
  if (kind === "sugar") {
    return (
      <svg {...common}>
        <path d="M5 9l7-4 7 4-7 4zM5 9v7l7 4v-7zM19 9v7l-7 4v-7z" fill="#f7f3df" stroke="#b9c7bd" strokeWidth="1.1" />
      </svg>
    );
  }
  if (kind === "tobacco") {
    return (
      <svg {...common}>
        <path d="M12 20C3.5 16.7 4.3 7.5 19.8 4.2 18.5 14.4 15.6 18.6 12 20z" fill="#9b6735" stroke="#d7aa70" strokeWidth="1.2" />
        <path d="M8.2 16.8L17 7.8M12.5 12.3l3.2.2M10.1 14.8l-.2-3.2" stroke="#5f3a21" strokeWidth="1" />
      </svg>
    );
  }
  if (kind === "coffee") {
    return (
      <svg {...common}>
        <ellipse cx="12" cy="12" rx="7.5" ry="9" fill="#6e4028" stroke="#c58a5e" strokeWidth="1.2" transform="rotate(28 12 12)" />
        <path d="M9 4.5c2.3 4.2 2 9.2-1.2 14.7" fill="none" stroke="#dfad7d" strokeWidth="1.3" transform="rotate(28 12 12)" />
      </svg>
    );
  }

  if (kind === "settler") {
    return (
      <svg {...common}>
        <path d="M4.2 16.2h13.4l.8 2.3H3.6z" fill="#8a5a32" />
        <path d="M5.2 16.2 7.6 9.4h5.7l2.8 6.8" fill="#c9a36a" stroke="#5c3a20" strokeWidth="1.1" />
        <circle cx="7.4" cy="18.4" r="2" fill="#3d2a18" stroke="#d7b27a" strokeWidth="1" />
        <circle cx="16.2" cy="18.4" r="2" fill="#3d2a18" stroke="#d7b27a" strokeWidth="1" />
        <path d="M9.4 9.4V5.6h4.2l1.8 3.8" fill="#e6c98a" stroke="#5c3a20" strokeWidth="1" />
      </svg>
    );
  }
  if (kind === "mayor") {
    return (
      <svg {...common}>
        <circle cx="7.2" cy="8.4" r="2.3" fill="#ead6b7" />
        <path d="M3.6 17.8c.3-4 1.6-6.2 3.6-6.2s3.3 2.2 3.6 6.2z" fill="#7a3428" />
        <circle cx="16.8" cy="8.4" r="2.3" fill="#ead6b7" />
        <path d="M13.2 17.8c.3-4 1.6-6.2 3.6-6.2s3.3 2.2 3.6 6.2z" fill="#7a3428" />
        <circle cx="12" cy="7.2" r="2.6" fill="#f3e2c7" />
        <path d="M8.1 18.4c.4-4.6 1.9-7.2 3.9-7.2s3.5 2.6 3.9 7.2z" fill="#9a3628" />
      </svg>
    );
  }
  if (kind === "builder") {
    return (
      <svg {...common}>
        <path d="M4 19.4V9.2h16v10.2" fill="#8d6a45" stroke="#efd3a2" strokeWidth="1.1" />
        <path d="M6 19.4V12h3v7.4M11 19.4V11h3v8.4M16 19.4V13h3v6.4" fill="#c4a06a" />
        <path d="M3.4 9.2h17.2M3.4 13h17.2M3.4 16.4h17.2" stroke="#5c3a20" strokeWidth="1" />
        <path d="M5.2 8.4 12 4.2 18.8 8.4" fill="none" stroke="#d7b27a" strokeWidth="1.3" />
      </svg>
    );
  }
  if (kind === "craftsman") {
    return (
      <svg {...common}>
        <rect x="3.4" y="12.6" width="8.2" height="6.2" rx="0.6" fill="#b8894d" stroke="#5c3a20" strokeWidth="1" />
        <rect x="12.4" y="13.4" width="8.2" height="5.4" rx="0.6" fill="#c9a36a" stroke="#5c3a20" strokeWidth="1" />
        <rect x="7.4" y="6.4" width="9.2" height="6.4" rx="0.6" fill="#e0bf7a" stroke="#5c3a20" strokeWidth="1" />
        <path d="M5.2 15.6h4.6M14.4 16h4.2M9.6 9.5h4.8" stroke="#7b5428" strokeWidth="1" />
      </svg>
    );
  }
  if (kind === "trader") {
    return (
      <svg {...common}>
        <path d="M7.2 9.6c.6-3.4 2.1-5.4 4.8-5.4s4.2 2 4.8 5.4" fill="#c9a36a" stroke="#5c3a20" strokeWidth="1.1" />
        <path d="M5.2 10.2h13.6l-1.4 10.2H6.6z" fill="#d8b56a" stroke="#5c3a20" strokeWidth="1.2" />
        <path d="M9.4 7.8h5.2c.2 1.4.2 2.6 0 3.4H9.4c-.2-.8-.2-2 0-3.4z" fill="#8a5a32" />
        <path d="M8.4 14.4h7.2M7.8 17.2h8.4" stroke="#7b5428" strokeWidth="1" />
      </svg>
    );
  }
  if (kind === "captain") {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="7.6" fill="none" stroke="#d7b27a" strokeWidth="2.2" />
        <circle cx="12" cy="12" r="2.2" fill="#c9a36a" stroke="#5c3a20" strokeWidth="1" />
        <path d="M12 3.6v3.2M12 17.2v3.2M3.6 12h3.2M17.2 12h3.2M6.2 6.2l2.2 2.2M15.6 15.6l2.2 2.2M6.2 17.8l2.2-2.2M15.6 8.4l2.2-2.2" stroke="#efd3a2" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    );
  }
  if (kind === "prospector") {
    return (
      <svg {...common}>
        <path d="M5 19.4 11.4 8.6" stroke="#c9a36a" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M9.4 6.2 13.6 9.8 11.8 11.4 7.6 7.8z" fill="#8a5a32" stroke="#efd3a2" strokeWidth="1" />
        <path d="M13.2 19.2 19.4 8.2" stroke="#c9a36a" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M16.6 5.4c2.6.4 3.8 2.4 3.6 4.6-1.8-.2-3.2-1.4-3.8-3.2z" fill="#8d8f93" stroke="#d7dcdb" strokeWidth="1" />
      </svg>
    );
  }

  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="9" fill="#70442a" stroke="#efcf91" strokeWidth="1.4" />
    </svg>
  );
}
