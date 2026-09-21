import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PLAYER_BOARD_PANEL_ID, PlayerSeats, nextSeatIndex } from "./PlayerSeats";

describe("nextSeatIndex", () => {
  it("wraps with arrow keys and jumps with Home/End", () => {
    expect(nextSeatIndex(0, "ArrowRight", 3)).toBe(1);
    expect(nextSeatIndex(2, "ArrowRight", 3)).toBe(0);
    expect(nextSeatIndex(0, "ArrowLeft", 3)).toBe(2);
    expect(nextSeatIndex(1, "ArrowUp", 3)).toBe(0);
    expect(nextSeatIndex(1, "Home", 3)).toBe(0);
    expect(nextSeatIndex(0, "End", 3)).toBe(2);
    expect(nextSeatIndex(0, "Enter", 3)).toBeNull();
  });
});

describe("PlayerSeats", () => {
  it("renders a tablist with aria-selected on the current seat", () => {
    const html = renderToStaticMarkup(
      createElement(PlayerSeats, {
        players: [
          { id: "p0", name: "你" },
          { id: "p1", name: "伊莎貝拉" },
        ],
        selectedIndex: 1,
        turnSeat: 0,
        governorIndex: 0,
        onSelect: () => undefined,
      }),
    );
    expect(html).toContain('role="tablist"');
    expect(html).toContain('role="tab"');
    expect(html).toContain(`aria-controls="${PLAYER_BOARD_PANEL_ID}"`);
    expect(html).toMatch(/aria-selected="true"[^>]*id="player-seat-tab-p1"|id="player-seat-tab-p1"[^>]*aria-selected="true"/);
    expect(html).toMatch(/aria-selected="false"[^>]*id="player-seat-tab-p0"|id="player-seat-tab-p0"[^>]*aria-selected="false"/);
  });
});
