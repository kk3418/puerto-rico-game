import { useRef, type KeyboardEvent } from "react";

export const PLAYER_BOARD_PANEL_ID = "player-board-panel";

export function nextSeatIndex(current: number, key: string, count: number): number | null {
  if (count <= 0) return null;
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
      return (current + 1) % count;
    case "ArrowLeft":
    case "ArrowUp":
      return (current - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}

export function PlayerSeats({
  players,
  selectedIndex,
  turnSeat,
  governorIndex,
  onSelect,
}: {
  players: Array<{ id: string; name: string }>;
  selectedIndex: number;
  turnSeat: number | null;
  governorIndex: number;
  onSelect: (index: number) => void;
}) {
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  function selectSeat(index: number) {
    onSelect(index);
    tabRefs.current[index]?.focus();
  }

  function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next = nextSeatIndex(index, event.key, players.length);
    if (next === null) return;
    event.preventDefault();
    selectSeat(next);
  }

  return (
    <div className="player-seats" role="tablist" aria-label="玩家座位">
      {players.map((player, index) => {
        const selected = index === selectedIndex;
        const acting = index === turnSeat;
        return (
          <button
            key={player.id}
            ref={(node) => {
              tabRefs.current[index] = node;
            }}
            type="button"
            role="tab"
            id={`player-seat-tab-${player.id}`}
            className={`player-seat-tab${selected ? " selected" : ""}${acting ? " acting" : ""}`}
            aria-selected={selected}
            aria-controls={PLAYER_BOARD_PANEL_ID}
            tabIndex={selected ? 0 : -1}
            onClick={() => selectSeat(index)}
            onKeyDown={(event) => onTabKeyDown(event, index)}
          >
            <span className="seat-number">座位 {index + 1}</span>
            <strong>
              {player.name}
              {index === 0 ? "（你）" : ""}
            </strong>
            {index === governorIndex && <span className="seat-status">總督</span>}
            {acting && <span className="seat-status">行動中</span>}
          </button>
        );
      })}
    </div>
  );
}
