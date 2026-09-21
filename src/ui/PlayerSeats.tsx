import { useRef, type KeyboardEvent } from "react";

export const PLAYER_BOARD_PANEL_ID = "player-board-panel";

/** Seats clockwise around the table, starting with the player to `startIndex`'s left. */
export function clockwiseFrom(startIndex: number, count: number): number[] {
  return Array.from({ length: count - 1 }, (_, offset) => (startIndex + offset + 1) % count);
}

/** Human first, then opponents clockwise from their left. */
export function seatTabOrder(youIndex: number, count: number): number[] {
  return [youIndex, ...clockwiseFrom(youIndex, count)];
}

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
  seats,
  selectedIndex,
  turnSeat,
  governorIndex,
  onSelect,
}: {
  seats: Array<{ player: { id: string; name: string; isHuman: boolean }; playerIndex: number }>;
  selectedIndex: number;
  turnSeat: number | null;
  governorIndex: number;
  onSelect: (playerIndex: number) => void;
}) {
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  function selectDisplaySeat(displayIndex: number) {
    const seat = seats[displayIndex];
    if (!seat) return;
    onSelect(seat.playerIndex);
    tabRefs.current[displayIndex]?.focus();
  }

  function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, displayIndex: number) {
    const next = nextSeatIndex(displayIndex, event.key, seats.length);
    if (next === null) return;
    event.preventDefault();
    selectDisplaySeat(next);
  }

  return (
    <div className="player-seats" role="tablist" aria-label="玩家座位">
      {seats.map((seat, displayIndex) => {
        const { player, playerIndex } = seat;
        const selected = playerIndex === selectedIndex;
        const acting = playerIndex === turnSeat;
        return (
          <button
            key={player.id}
            ref={(node) => {
              tabRefs.current[displayIndex] = node;
            }}
            type="button"
            role="tab"
            id={`player-seat-tab-${player.id}`}
            className={`player-seat-tab${selected ? " selected" : ""}${acting ? " acting" : ""}`}
            aria-selected={selected}
            aria-controls={PLAYER_BOARD_PANEL_ID}
            tabIndex={selected ? 0 : -1}
            onClick={() => selectDisplaySeat(displayIndex)}
            onKeyDown={(event) => onTabKeyDown(event, displayIndex)}
          >
            <span className="seat-number">座位 {playerIndex + 1}</span>
            <strong>
              {player.name}
              {player.isHuman ? "（你）" : ""}
            </strong>
            {playerIndex === governorIndex && <span className="seat-status">總督</span>}
            {acting && <span className="seat-status">行動中</span>}
          </button>
        );
      })}
    </div>
  );
}
