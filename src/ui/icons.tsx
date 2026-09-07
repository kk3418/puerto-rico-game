import type { Good, Role, TileType } from "../engine/types";

export type IconKind = Good | TileType | Role | "coin" | "vp" | "colonist" | "ship";

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

  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="9" fill="#70442a" stroke="#efcf91" strokeWidth="1.4" />
      <text x="12" y="15" textAnchor="middle" fontSize="9" fontWeight="900" fill="#fff4d2">
        {roleMark(kind)}
      </text>
    </svg>
  );
}

function roleMark(role: Role): string {
  return {
    settler: "拓",
    mayor: "市",
    builder: "建",
    craftsman: "工",
    trader: "商",
    captain: "船",
    prospector: "金",
  }[role];
}
