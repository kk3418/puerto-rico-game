import { describe, expect, it } from "vitest";
import { aggregateUserStats, humanWonMatch } from "./stats";

describe("aggregateUserStats", () => {
  it("counts a unique high score as a win and ignores unfinished rows", () => {
    const stats = aggregateUserStats(
      [
        {
          endedAt: new Date("2026-01-02"),
          participants: [
            { isHuman: true, userId: "u1", total: 40, goodsAndGold: 3 },
            { isHuman: false, userId: null, total: 38, goodsAndGold: 8 },
          ],
        },
        {
          endedAt: new Date("2026-01-01"),
          participants: [
            { isHuman: true, userId: "u1", total: 12, goodsAndGold: 1 },
            { isHuman: false, userId: null, total: 30, goodsAndGold: 4 },
          ],
        },
        {
          endedAt: new Date("2026-01-03"),
          participants: [
            { isHuman: true, userId: "u1", total: null, goodsAndGold: null },
            { isHuman: false, userId: null, total: 1, goodsAndGold: 0 },
          ],
        },
      ],
      "u1",
    );
    expect(stats.gamesPlayed).toBe(2);
    expect(stats.gamesWon).toBe(1);
    expect(stats.totalScore).toBe(52);
    expect(stats.bestScore).toBe(40);
    expect(stats.lastPlayedAt?.toISOString()).toBe("2026-01-02T00:00:00.000Z");
  });

  it("does not count an equal victory-point and goods-and-gold tie as a unique win", () => {
    expect(
      humanWonMatch(
        [
          { isHuman: true, userId: "u1", total: 20, goodsAndGold: 4 },
          { isHuman: false, userId: null, total: 20, goodsAndGold: 4 },
        ],
        "u1",
      ),
    ).toBe(false);
  });

  it("counts a victory-point tie as a win when goods and gold break it", () => {
    expect(
      humanWonMatch(
        [
          { isHuman: true, userId: "u1", total: 20, goodsAndGold: 6 },
          { isHuman: false, userId: null, total: 20, goodsAndGold: 5 },
        ],
        "u1",
      ),
    ).toBe(true);
  });
});
