import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  PLAYER_BOARD_PANEL_ID,
  PlayerSeats,
  clockwiseFrom,
  nextSeatIndex,
  seatTabOrder,
} from "./PlayerSeats";

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

describe("seatTabOrder", () => {
  it("puts the human first, then opponents clockwise", () => {
    expect(clockwiseFrom(2, 4)).toEqual([3, 0, 1]);
    expect(seatTabOrder(2, 4)).toEqual([2, 3, 0, 1]);
  });
});

describe("PlayerSeats", () => {
  it("renders a tablist with aria-selected on the current engine seat", () => {
    const html = renderToStaticMarkup(
      createElement(PlayerSeats, {
        seats: [
          { player: { id: "p2", name: "你", isHuman: true }, playerIndex: 2 },
          { player: { id: "p0", name: "伊莎貝拉", isHuman: false }, playerIndex: 0 },
        ],
        selectedIndex: 0,
        turnSeat: 2,
        governorIndex: 2,
        onSelect: () => undefined,
      }),
    );
    expect(html).toContain('role="tablist"');
    expect(html).toContain('role="tab"');
    expect(html).toContain(`aria-controls="${PLAYER_BOARD_PANEL_ID}"`);
    expect(html).toContain("（你）");
    expect(html).toMatch(
      /aria-selected="true"[^>]*id="player-seat-tab-p0"|id="player-seat-tab-p0"[^>]*aria-selected="true"/,
    );
    expect(html).toMatch(
      /aria-selected="false"[^>]*id="player-seat-tab-p2"|id="player-seat-tab-p2"[^>]*aria-selected="false"/,
    );
  });
});
