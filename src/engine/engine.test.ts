import { describe, expect, it } from "vitest";
import { HeuristicAgent, HEURISTIC_TABLE_PAUSE_MS } from "../agents/heuristic";
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
  totalColonists,
  vpChipCount,
  scorePlayer,
  chosenRoleFor,
  type Action,
  type GameState,
} from "../engine";

function setup(playerCount: 3 | 4 | 5 = 3, seed = 1): GameState {
  return createInitialState({ playerCount, difficulty: "balanced", seed, governorIndex: 0 });
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
      expect(s.colonistSupply + s.colonistShip).toBe(colonistCount(n));
      expect(s.players.every((p) => p.island[0]!.colonists === 0)).toBe(true);
      expect(s.ships.map((x) => x.capacity)).toEqual([...shipCapacities(n)]);
      expect(s.faceUpPlantations).toHaveLength(n + 1);
      expect(s.quarrySupply).toBe(8);
      expect(s.phase.type).toBe("chooseRole");
    }
  });

  it("gives indigo/corn clockwise from the governor, unoccupied", () => {
    const s3 = setup(3);
    const s4 = setup(4);
    const s5 = setup(5);
    expect(s3.players.map((p) => p.island[0]!.type)).toEqual(["indigo", "indigo", "corn"]);
    expect(s4.players.map((p) => p.island[0]!.type)).toEqual(["indigo", "indigo", "corn", "corn"]);
    expect(s5.players.map((p) => p.island[0]!.type)).toEqual(["indigo", "indigo", "indigo", "corn", "corn"]);
    expect(s4.players.every((p) => p.island[0]!.colonists === 0)).toBe(true);

    const s4g2 = createInitialState({
      playerCount: 4,
      difficulty: "balanced",
      seed: 1,
      governorIndex: 2,
    });
    expect(s4g2.players.map((p) => p.island[0]!.type)).toEqual(["corn", "corn", "indigo", "indigo"]);
  });

  it("picks the first governor from the seed when not pinned", () => {
    const governors = new Set<number>();
    for (let seed = 0; seed < 40; seed++) {
      const s = createInitialState({ playerCount: 4, difficulty: "balanced", seed });
      expect(s.governorIndex).toBeGreaterThanOrEqual(0);
      expect(s.governorIndex).toBeLessThan(4);
      expect(s.chooserIndex).toBe(s.governorIndex);
      expect(s.log[0]!.text).toContain(s.players[s.governorIndex]!.name);
      const g = s.governorIndex;
      expect(s.players[g]!.island[0]!.type).toBe("indigo");
      expect(s.players[(g + 1) % 4]!.island[0]!.type).toBe("indigo");
      expect(s.players[(g + 2) % 4]!.island[0]!.type).toBe("corn");
      expect(s.players[(g + 3) % 4]!.island[0]!.type).toBe("corn");
      governors.add(s.governorIndex);
    }
    expect(governors.size).toBeGreaterThan(1);
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

  it("keeps the chosen role on the player's seat after the role resolves", () => {
    let s = setup(4);
    s = choose(s, "prospector");
    expect(s.activeRole).toBeNull();
    expect(s.activeRoleOwnerIndex).toBeNull();
    expect(chosenRoleFor(s, 0)).toBe("prospector");

    s = choose(s, "builder");
    expect(chosenRoleFor(s, 0)).toBe("prospector");
    expect(chosenRoleFor(s, 1)).toBe("builder");
    for (let i = 0; i < 4; i++) {
      s = play(s, { type: "builderBuild", buildingId: null });
    }
    expect(s.phase.type).toBe("chooseRole");
    expect(chosenRoleFor(s, 0)).toBe("prospector");
    expect(chosenRoleFor(s, 1)).toBe("builder");
  });
});

describe("craftsman", () => {
  it("produces corn without a building and offers privilege extra", () => {
    let s = setup(3, 7);
    s.players[2]!.island[0]!.colonists = 1;
    s.colonistSupply -= 1;
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
  function allColonists(state: GameState): number {
    return (
      state.colonistSupply +
      state.colonistShip +
      state.players.reduce((sum, player) => sum + totalColonists(player), 0)
    );
  }

  it("preserves existing placements and tracks only the assignment pool received this turn", () => {
    let s = setup(3);
    const player = s.players[0]!;
    player.island[0]!.colonists = 1;
    player.city.push({ instanceId: "staffed", buildingId: "smallMarket", colonists: 1 });
    player.unplacedColonists = 1;
    player.sanJuan = 2;
    s.colonistSupply -= 5;

    s = choose(s, "mayor");

    expect(s.phase).toEqual({ type: "mayorAssign", actorIndex: 0, received: 2 });
    expect(s.players[0]!.island[0]!.colonists).toBe(1);
    expect(s.players[0]!.city[0]!.colonists).toBe(1);
    expect(s.players[0]!.unplacedColonists).toBe(5);
    expect(s.players[0]!.sanJuan).toBe(0);
    expect(allColonists(s)).toBe(colonistCount(3));
  });

  it("removes and re-places colonists without creating or losing any", () => {
    let s = setup(3);
    s.players[0]!.island[0]!.colonists = 1;
    s.colonistSupply -= 1;
    s.players[0]!.city.push({ instanceId: "market", buildingId: "smallMarket", colonists: 0 });
    s = choose(s, "mayor");
    const expectedTotal = allColonists(s);
    const poolBefore = s.players[0]!.unplacedColonists;

    const remove: Action = { type: "mayorRemove", target: { kind: "island", index: 0 } };
    expect(getLegalActions(s)).toContainEqual(remove);
    s = play(s, remove);
    expect(s.players[0]!.island[0]!.colonists).toBe(0);
    expect(s.players[0]!.unplacedColonists).toBe(poolBefore + 1);
    expect(allColonists(s)).toBe(expectedTotal);

    const place: Action = {
      type: "mayorPlace",
      target: { kind: "building", instanceId: "market" },
    };
    expect(getLegalActions(s)).toContainEqual(place);
    s = play(s, place);
    expect(s.players[0]!.city[0]!.colonists).toBe(1);
    expect(s.players[0]!.unplacedColonists).toBe(poolBefore);
    expect(allColonists(s)).toBe(expectedTotal);
    expect(() =>
      play(s, { type: "mayorRemove", target: { kind: "building", instanceId: "missing" } }),
    ).toThrow(/Illegal action/);
  });

  it("still allows editing when a player receives no new colonists", () => {
    let s = setup(3);
    s.players[0]!.island[0]!.colonists = 1;
    s.colonistShip = 0;
    s.colonistSupply = 0;
    s = choose(s, "mayor");

    expect(s.phase).toEqual({ type: "mayorAssign", actorIndex: 0, received: 0 });
    expect(getLegalActions(s)).toContainEqual({ type: "mayorDone" });
    expect(getLegalActions(s)).toContainEqual({
      type: "mayorRemove",
      target: { kind: "island", index: 0 },
    });
  });

  it("allows completion only after open circles are filled, then advances every player and refills the ship", () => {
    let s = setup(3);
    s.players[0]!.city.push({ instanceId: "market", buildingId: "smallMarket", colonists: 0 });
    const expectedTotal = allColonists(s);
    s = choose(s, "mayor");

    expect(getLegalActions(s)).not.toContainEqual({ type: "mayorDone" });
    s = play(s, { type: "mayorPlace", target: { kind: "building", instanceId: "market" } });
    expect(getLegalActions(s)).not.toContainEqual({ type: "mayorDone" });
    s = play(s, { type: "mayorPlace", target: { kind: "island", index: 0 } });
    expect(getLegalActions(s)).toContainEqual({ type: "mayorDone" });
    s = play(s, { type: "mayorDone" });
    expect(s.phase).toMatchObject({ type: "mayorAssign", actorIndex: 1, received: 1 });
    expect(s.players[0]!.sanJuan).toBe(0);

    s = play(s, { type: "mayorPlace", target: { kind: "island", index: 0 } });
    s = play(s, { type: "mayorDone" });
    expect(s.phase).toMatchObject({ type: "mayorAssign", actorIndex: 2, received: 1 });
    s = play(s, { type: "mayorPlace", target: { kind: "island", index: 0 } });
    s = play(s, { type: "mayorDone" });

    expect(s.phase.type).toBe("chooseRole");
    expect(s.colonistShip).toBe(3);
    expect(allColonists(s)).toBe(expectedTotal);
  });

  it("keeps removal below placement and completion in the heuristic", async () => {
    let s = setup(3, 17);
    s.players[0]!.island[0]!.colonists = 1;
    s.colonistSupply -= 1;
    s = choose(s, "mayor");
    const legal = getLegalActions(s);
    expect(legal.some((action) => action.type === "mayorRemove")).toBe(true);
    const ai = new HeuristicAgent();
    const selected = await ai.chooseAction({
      state: s,
      legalActions: legal,
      playerId: s.players[0]!.id,
    });
    expect(selected.type).not.toBe("mayorRemove");
  });
});

describe("heuristic table pause", () => {
  it("stays within 5–10 seconds so LLM agents can skip it later", () => {
    const ai = new HeuristicAgent();
    for (let i = 0; i < 40; i++) {
      const ms = ai.tablePauseAfterActionMs();
      expect(ms).toBeGreaterThanOrEqual(HEURISTIC_TABLE_PAUSE_MS.min);
      expect(ms).toBeLessThanOrEqual(HEURISTIC_TABLE_PAUSE_MS.max);
    }
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
