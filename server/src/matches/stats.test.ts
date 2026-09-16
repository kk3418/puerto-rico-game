import { describe, expect, it } from "vitest";
import { aggregateUserStats, humanWonMatch } from "./stats";

describe("aggregateUserStats", () => {
  it("counts a unique high score as a win and ignores unfinished rows", () => {
    const stats = aggregateUserStats(
      [
        {
          endedAt: new Date("2026-01-02"),
          participants: [
            { isHuman: true, userId: "u1", total: 40 },
            { isHuman: false, userId: null, total: 38 },
          ],
        },
        {
          endedAt: new Date("2026-01-01"),
          participants: [
            { isHuman: true, userId: "u1", total: 12 },
            { isHuman: false, userId: null, total: 30 },
          ],
        },
        {
          endedAt: new Date("2026-01-03"),
          participants: [
            { isHuman: true, userId: "u1", total: null },
            { isHuman: false, userId: null, total: 1 },
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

  it("does not count a total-score tie as a win", () => {
    expect(
      humanWonMatch(
        [
          { isHuman: true, userId: "u1", total: 20 },
          { isHuman: false, userId: null, total: 20 },
        ],
        "u1",
      ),
    ).toBe(false);
  });
});
