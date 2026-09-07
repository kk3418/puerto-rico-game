import { describe, expect, it } from "vitest";
import { HeuristicAgent } from "../agents/heuristic";
import { dispatchAction } from "../agents/turnLoop";
import {
  applyAction,
  assertSerializable,
  cloneViaJson,
  createInitialState,
  getActorIndex,
  getLegalActions,
  occupiedBuilding,
  shipCapacities,
  startingDoubloons,
  colonistCount,
  vpChipCount,
  scorePlayer,
  type Action,
  type GameState,
} from "../engine";

function setup(playerCount: 3 | 4 | 5 = 3, seed = 1): GameState {
  return createInitialState({ playerCount, difficulty: "balanced", seed });
}

function play(state: GameState, action: Action): GameState {
  return applyAction(state, action);
}

function choose(state: GameState, role: string): GameState {
  const slot = state.roles.find((r) => r.role === role && !r.taken);
  if (!slot) throw new Error(`role ${role} not available`);
  return play(state, { type: "chooseRole", roleId: slot.id });
}

describe("setup", () => {
  it("sets 3/4/5 player supplies, money, and ships", () => {
    for (const n of [3, 4, 5] as const) {
      const s = setup(n);
      expect(s.players).toHaveLength(n);
      expect(s.players[0]!.doubloons).toBe(startingDoubloons(n));
      expect(s.vpSupply).toBe(vpChipCount(n));
      expect(s.colonistSupply + n + s.colonistShip).toBe(colonistCount(n));
      expect(s.ships.map((x) => x.capacity)).toEqual([...shipCapacities(n)]);
      expect(s.faceUpPlantations).toHaveLength(n + 1);
      expect(s.quarrySupply).toBe(8);
      expect(s.phase.type).toBe("chooseRole");
    }
  });

  it("gives indigo/corn according to seat", () => {
    const s3 = setup(3);
    const s4 = setup(4);
    const s5 = setup(5);
    expect(s3.players.map((p) => p.island[0]!.type)).toEqual(["indigo", "indigo", "corn"]);
    expect(s4.players.map((p) => p.island[0]!.type)).toEqual(["indigo", "indigo", "corn", "corn"]);
    expect(s5.players.map((p) => p.island[0]!.type)).toEqual(["indigo", "indigo", "indigo", "corn", "corn"]);
    expect(s4.players.every((p) => p.island[0]!.colonists === 1)).toBe(true);
  });

  it("deals prospectors by player count", () => {
    expect(setup(3).roles.filter((r) => r.role === "prospector")).toHaveLength(0);
    expect(setup(4).roles.filter((r) => r.role === "prospector")).toHaveLength(1);
    expect(setup(5).roles.filter((r) => r.role === "prospector")).toHaveLength(2);
  });
});

describe("serialization", () => {
  it("round-trips GameState and still applies the same action", () => {
    const s = setup(3, 42);
    assertSerializable(s);
    const copy = cloneViaJson(s);
    const action = getLegalActions(s)[0]!;
    const a = applyAction(s, action);
    const b = applyAction(copy, action);
    expect(JSON.stringify(a.players)).toEqual(JSON.stringify(b.players));
    expect(JSON.stringify(a.phase)).toEqual(JSON.stringify(b.phase));
  });
});

describe("illegal actions", () => {
  it("rejects an action that is not legal", () => {
    const s = setup();
    expect(() => play(s, { type: "builderBuild", buildingId: "wharf" })).toThrow(/Illegal action/);
  });
});

describe("prospector", () => {
  it("gives the privilege player 1 doubloon and returns to role select", () => {
    let s = setup(4);
    const gold = s.players[0]!.doubloons;
    s = choose(s, "prospector");
    expect(s.players[0]!.doubloons).toBe(gold + 1);
    expect(s.phase.type).toBe("chooseRole");
    expect(s.chooserIndex).toBe(1);
  });
});

describe("craftsman", () => {
  it("produces corn without a building and offers privilege extra", () => {
    let s = setup(3, 7);
    s = choose(s, "craftsman");
    expect(s.phase.type).toBe("craftsmanPrivilege");
    expect(s.players[0]!.goods.indigo).toBe(0);
    expect(s.players[1]!.goods.indigo).toBe(0);
    expect(s.players[2]!.goods.corn).toBe(1);
    const extra = getLegalActions(s).filter((a) => a.type === "craftsmanExtra");
    expect(extra.some((a) => a.type === "craftsmanExtra" && a.good === null)).toBe(true);
  });
});

describe("builder privilege and quarries", () => {
  it("lets the builder buy small indigo for 0 with privilege", () => {
    let s = setup(3);
    s = choose(s, "builder");
    expect(s.phase.type).toBe("builder");
    const legal = getLegalActions(s);
    expect(legal).toContainEqual({ type: "builderBuild", buildingId: "smallIndigo" });
    const gold = s.players[0]!.doubloons;
    s = play(s, { type: "builderBuild", buildingId: "smallIndigo" });
    expect(s.players[0]!.city[0]!.buildingId).toBe("smallIndigo");
    expect(s.players[0]!.doubloons).toBe(gold - 0);
  });
});

describe("trader", () => {
  it("empties the trading house at end of phase when full", () => {
    let s = setup(3);
    s.players[0]!.goods.indigo = 1;
    s.players[1]!.goods.sugar = 1;
    s.players[2]!.goods.tobacco = 1;
    s.players[0]!.goods.coffee = 1;
    s.tradingHouse = [];
    s = choose(s, "trader");
    s = play(s, { type: "traderSell", good: "coffee" });
    s = play(s, { type: "traderSell", good: "sugar" });
    s = play(s, { type: "traderSell", good: "tobacco" });
    expect(s.phase.type).toBe("chooseRole");
    expect(s.tradingHouse).toHaveLength(3);
  });

  it("returns goods when 4 sales fill the house", () => {
    let s = setup(4, 3);
    s.players[0]!.goods.corn = 1;
    s.players[1]!.goods.indigo = 1;
    s.players[2]!.goods.sugar = 1;
    s.players[3]!.goods.tobacco = 1;
    s = choose(s, "trader");
    s = play(s, { type: "traderSell", good: "corn" });
    s = play(s, { type: "traderSell", good: "indigo" });
    s = play(s, { type: "traderSell", good: "sugar" });
    s = play(s, { type: "traderSell", good: "tobacco" });
    expect(s.tradingHouse).toHaveLength(0);
  });
});

describe("captain", () => {
  it("loads goods for VP and dumps leftovers beyond one barrel", () => {
    let s = setup(3, 9);
    s.players[0]!.goods.corn = 3;
    s.players[1]!.goods.indigo = 0;
    s.players[2]!.goods.sugar = 0;
    s = choose(s, "captain");
    expect(s.phase.type).toBe("captainLoad");
    const load = getLegalActions(s).find((a) => a.type === "captainLoad");
    expect(load).toMatchObject({ type: "captainLoad", good: "corn" });
    s = play(s, load!);
    expect(s.players[0]!.vpChips).toBeGreaterThanOrEqual(3);
    expect(s.ships.some((ship) => ship.good === "corn")).toBe(true);
  });

  it("keeps a full ship occupied until the end of the captain phase", () => {
    let s = setup(3, 2);
    s.players[0]!.goods.sugar = 4;
    s.players[1]!.goods.tobacco = 2;
    s.ships[0] = { capacity: 4, good: null, loaded: 0 };
    s.ships[1] = { capacity: 5, good: null, loaded: 0 };
    s.ships[2] = { capacity: 6, good: null, loaded: 0 };
    s = choose(s, "captain");
    const load4 = getLegalActions(s).find(
      (a) => a.type === "captainLoad" && a.good === "sugar" && a.destination === 0,
    );
    expect(load4).toBeTruthy();
    s = play(s, load4!);
    expect(s.phase.type).toBe("captainLoad");
    expect(s.ships[0]).toMatchObject({ good: "sugar", loaded: 4 });
  });

  it("forces the empty ship that loads the most barrels", () => {
    let s = setup(3, 2);
    s.players[0]!.goods.sugar = 6;
    s = choose(s, "captain");
    const dests = getLegalActions(s)
      .filter((a) => a.type === "captainLoad" && a.good === "sugar" && a.destination !== "wharf")
      .map((a) => (a.type === "captainLoad" ? a.destination : null));
    expect(dests).toEqual([2]);
  });
});

describe("mayor", () => {
  it("gives the mayor an extra colonist and distributes the ship", () => {
    let s = setup(3);
    const before = s.colonistShip;
    s = choose(s, "mayor");
    expect(s.phase.type).toBe("mayorAssign");
    const placed = s.players.reduce(
      (n, p) => n + p.unplacedColonists + p.sanJuan + p.island.reduce((a, t) => a + t.colonists, 0),
      0,
    );
    expect(placed).toBeGreaterThanOrEqual(before + 1 + 3);
  });
});

describe("settler privilege", () => {
  it("allows the settler to take a quarry", () => {
    let s = setup(3);
    s = choose(s, "settler");
    const legal = getLegalActions(s);
    expect(legal.some((a) => a.type === "settlerTake" && a.source === "quarry")).toBe(true);
    s = play(s, { type: "settlerTake", source: "quarry" });
    expect(s.players[0]!.island.some((t) => t.type === "quarry")).toBe(true);
  });
});

describe("end scoring", () => {
  it("adds guild hall, residence, fortress, customs house, and city hall bonuses when occupied", () => {
    const s = setup(3);
    const p = s.players[0]!;
    p.vpChips = 8;
    p.city = [
      { instanceId: "1", buildingId: "smallIndigo", colonists: 1 },
      { instanceId: "2", buildingId: "largeSugar", colonists: 1 },
      { instanceId: "3", buildingId: "smallMarket", colonists: 1 },
      { instanceId: "4", buildingId: "guildHall", colonists: 1 },
      { instanceId: "5", buildingId: "residence", colonists: 1 },
      { instanceId: "6", buildingId: "fortress", colonists: 1 },
      { instanceId: "7", buildingId: "customsHouse", colonists: 1 },
      { instanceId: "8", buildingId: "cityHall", colonists: 1 },
    ];
    while (p.island.length < 10) p.island.push({ type: "corn", colonists: 1 });
    const score = scorePlayer(p);
    expect(score.guildHall).toBe(1 + 2);
    expect(score.residence).toBe(5);
    expect(score.customsHouse).toBe(2);
    expect(score.cityHall).toBeGreaterThanOrEqual(6);
    expect(score.fortress).toBeGreaterThan(0);
    expect(score.total).toBe(
      score.vpChips +
        score.buildingVp +
        score.guildHall +
        score.residence +
        score.fortress +
        score.customsHouse +
        score.cityHall,
    );
  });
});

describe("turn loop rejects illegal agent actions", () => {
  it("throws when dispatching a non-legal action", async () => {
    const s = setup();
    await expect(dispatchAction(s, { type: "captainPass" })).rejects.toThrow(/illegal/i);
  });
});

describe("heuristic smoke", () => {
  it("can play a sequence of legal moves without throwing", async () => {
    let s = setup(3, 99);
    const ai = new HeuristicAgent();
    for (let i = 0; i < 40; i++) {
      if (s.gameOver) break;
      const legal = getLegalActions(s);
      if (legal.length === 0) break;
      const idx = s.phase.type === "chooseRole" ? s.chooserIndex : "actorIndex" in s.phase ? s.phase.actorIndex : 0;
      const player = s.players[idx]!;
      const action = await ai.chooseAction({ state: s, legalActions: legal, playerId: player.id });
      s = applyAction(s, action);
    }
    expect(s.round).toBeGreaterThanOrEqual(1);
  });
});

describe("full AI game", () => {
  it("reaches game over with scores", async () => {
    let s = setup(3, 2024);
    s = cloneViaJson(s);
    s.players.forEach((p) => {
      p.isHuman = false;
    });
    const ai = new HeuristicAgent();
    let guard = 0;
    while (!s.gameOver && guard++ < 5000) {
      const legal = getLegalActions(s);
      if (legal.length === 0) {
        throw new Error(`No legal actions in ${s.phase.type} round ${s.round}`);
      }
      const idx = getActorIndex(s);
      if (idx === null) throw new Error("no actor");
      const player = s.players[idx]!;
      const action = await ai.chooseAction({ state: s, legalActions: legal, playerId: player.id });
      s = applyAction(s, action);
    }
    expect(s.gameOver).toBe(true);
    expect(s.scores?.length).toBe(3);
    expect(s.scores![0]!.total).toBeGreaterThan(0);
  }, 20000);
});

describe("occupied helper", () => {
  it("treats unstaffed buildings as inactive", () => {
    const s = setup();
    s.players[0]!.city.push({ instanceId: "x", buildingId: "hacienda", colonists: 0 });
    expect(occupiedBuilding(s.players[0]!, "hacienda")).toBe(false);
  });
});

describe("violet buildings", () => {
  it("pays factory money by number of good types produced", () => {
    let s = setup(3, 11);
    const p = s.players[0]!;
    p.island = [
      { type: "corn", colonists: 1 },
      { type: "indigo", colonists: 1 },
    ];
    p.city = [
      { instanceId: "f", buildingId: "factory", colonists: 1 },
      { instanceId: "i", buildingId: "smallIndigo", colonists: 1 },
    ];
    const gold = p.doubloons;
    s = choose(s, "craftsman");
    expect(s.players[0]!.doubloons).toBe(gold + 1);
    expect(s.players[0]!.goods.corn).toBe(1);
    expect(s.players[0]!.goods.indigo).toBe(1);
  });

  it("lets an occupied office sell a duplicate type", () => {
    let s = setup(3);
    s.tradingHouse = ["indigo"];
    s.players[0]!.goods.indigo = 1;
    s.players[0]!.city = [{ instanceId: "o", buildingId: "office", colonists: 1 }];
    s = choose(s, "trader");
    expect(getLegalActions(s)).toContainEqual({ type: "traderSell", good: "indigo" });
    s = play(s, { type: "traderSell", good: "indigo" });
    expect(s.tradingHouse).toEqual(["indigo", "indigo"]);
  });

  it("places a hospice colonist on a newly taken plantation", () => {
    let s = setup(3);
    s.players[0]!.city = [{ instanceId: "h", buildingId: "hospice", colonists: 1 }];
    s.colonistSupply = 10;
    s = choose(s, "settler");
    const before = s.colonistSupply;
    s = play(s, { type: "settlerTake", source: "faceUp", index: 0 });
    const newest = s.players[0]!.island.at(-1)!;
    expect(newest.colonists).toBe(1);
    expect(s.colonistSupply).toBe(before - 1);
  });
});

describe("unused roles", () => {
  it("puts a doubloon on unchosen roles at the end of a governor round", () => {
    let s = setup(3, 5);
    s = choose(s, "builder");
    s = play(s, { type: "builderBuild", buildingId: null });
    s = play(s, { type: "builderBuild", buildingId: null });
    s = play(s, { type: "builderBuild", buildingId: null });
    s = choose(s, "craftsman");
    const extra = getLegalActions(s).find((a) => a.type === "craftsmanExtra" && a.good === null);
    s = play(s, extra ?? { type: "craftsmanExtra", good: null });
    s = choose(s, "trader");
    s = play(s, { type: "traderSell", good: null });
    s = play(s, { type: "traderSell", good: null });
    s = play(s, { type: "traderSell", good: null });
    expect(s.round).toBe(2);
    const leftover = s.roles.filter((r) => r.doubloons === 1).map((r) => r.role);
    expect(leftover.sort()).toEqual(["captain", "mayor", "settler"].sort());
  });
});
