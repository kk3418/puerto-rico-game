import { describe, expect, it } from "vitest";
import { aiDelayAfterAction } from "./aiDelay";

describe("aiDelayAfterAction", () => {
  const baseDelay = 800;

  it("runs sub-actions back-to-back while the same AI seat stays in the same phase", () => {
    expect(
      aiDelayAfterAction({
        seatIndex: 1,
        beforePhaseType: "mayorAssign",
        nextActorIndex: 1,
        nextPhaseType: "mayorAssign",
        baseDelay,
      }),
    ).toBe(0);
  });

  it("delays once the phase changes", () => {
    expect(
      aiDelayAfterAction({
        seatIndex: 1,
        beforePhaseType: "mayorAssign",
        nextActorIndex: 1,
        nextPhaseType: "builder",
        baseDelay,
      }),
    ).toBe(baseDelay);
  });

  it("delays when the actor changes to another seat", () => {
    expect(
      aiDelayAfterAction({
        seatIndex: 1,
        beforePhaseType: "settlerTake",
        nextActorIndex: 2,
        nextPhaseType: "settlerTake",
        baseDelay,
      }),
    ).toBe(baseDelay);
  });

  it("delays when the match ends", () => {
    expect(
      aiDelayAfterAction({
        seatIndex: 1,
        beforePhaseType: "captainStore",
        nextActorIndex: null,
        nextPhaseType: "gameOver",
        baseDelay,
      }),
    ).toBe(baseDelay);
  });
});
