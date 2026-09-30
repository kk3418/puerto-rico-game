import { useRef, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";

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
  youIndex,
  onSelect,
}: {
  seats: Array<{ player: { id: string; name: string; isHuman: boolean }; playerIndex: number }>;
  selectedIndex: number;
  turnSeat: number | null;
  governorIndex: number;
  /** Online tables mark every seat human; pass the viewer's seat to place the "you" suffix. */
  youIndex?: number;
  onSelect: (playerIndex: number) => void;
}) {
  const { t } = useTranslation("game");
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
    <div className="player-seats" role="tablist" aria-label={t("seatAria")}>
      {seats.map((seat, displayIndex) => {
        const { player, playerIndex } = seat;
        const selected = playerIndex === selectedIndex;
        const acting = playerIndex === turnSeat;
        const isYou = youIndex === undefined ? player.isHuman : playerIndex === youIndex;
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
            <span className="seat-number">{t("seatNumber", { n: playerIndex + 1 })}</span>
            <strong>
              {player.name}
              {isYou ? t("youSuffix") : ""}
            </strong>
            {playerIndex === governorIndex && <span className="seat-status">{t("governor")}</span>}
            {acting && <span className="seat-status">{t("acting")}</span>}
          </button>
        );
      })}
    </div>
  );
}
