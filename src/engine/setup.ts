import { emptyBuildingSupply } from "./buildings";
import { emptyGoods, refillFaceUp } from "./helpers";
import { shuffleInPlace } from "./rng";
import type { GameState, PlayerCount, PlayerState, Role, SetupOptions, TileType } from "./types";

const AI_NAMES = ["伊莎貝拉", "迭戈", "卡塔莉娜", "羅倫佐"];

export function colonistCount(playerCount: PlayerCount): number {
  return playerCount === 3 ? 55 : playerCount === 4 ? 75 : 95;
}

export function vpChipCount(playerCount: PlayerCount): number {
  return playerCount === 3 ? 75 : playerCount === 4 ? 100 : 122;
}

export function shipCapacities(playerCount: PlayerCount): [number, number, number] {
  if (playerCount === 3) return [4, 5, 6];
  if (playerCount === 4) return [5, 6, 7];
  return [6, 7, 8];
}

export function startingDoubloons(playerCount: PlayerCount): number {
  return playerCount - 1;
}

export function startingPlantations(playerCount: PlayerCount): TileType[] {
  if (playerCount === 3) return ["indigo", "indigo", "corn"];
  if (playerCount === 4) return ["indigo", "indigo", "corn", "corn"];
  return ["indigo", "indigo", "indigo", "corn", "corn"];
}

export function createInitialState(options: SetupOptions): GameState {
  const playerCount = options.playerCount;
  const seed = options.seed ?? Date.now() >>> 0;
  const starts = startingPlantations(playerCount);
  const players: PlayerState[] = [];

  for (let i = 0; i < playerCount; i++) {
    const isHuman = i === 0;
    players.push({
      id: `p${i}`,
      name: isHuman ? (options.humanName ?? "你") : `AI ${AI_NAMES[i - 1]}`,
      isHuman,
      doubloons: startingDoubloons(playerCount),
      vpChips: 0,
      island: [{ type: starts[i]!, colonists: 1 }],
      city: [],
      goods: emptyGoods(),
      sanJuan: 0,
      unplacedColonists: 0,
    });
  }

  const corn = Array<TileType>(10).fill("corn");
  const indigo = Array<TileType>(12).fill("indigo");
  const sugar = Array<TileType>(11).fill("sugar");
  const tobacco = Array<TileType>(9).fill("tobacco");
  const coffee = Array<TileType>(8).fill("coffee");

  for (const tile of starts) {
    if (tile === "corn") corn.pop();
    if (tile === "indigo") indigo.pop();
  }

  const deck: TileType[] = [...corn, ...indigo, ...sugar, ...tobacco, ...coffee];
  const rng = shuffleInPlace(deck, seed);

  const roles: Role[] =
    playerCount === 3
      ? ["settler", "mayor", "builder", "craftsman", "trader", "captain"]
      : playerCount === 4
        ? ["settler", "mayor", "builder", "craftsman", "trader", "captain", "prospector"]
        : ["settler", "mayor", "builder", "craftsman", "trader", "captain", "prospector", "prospector"];

  const colonists = colonistCount(playerCount);
  const shipColonists = playerCount;

  const state: GameState = {
    playerCount,
    players,
    governorIndex: 0,
    chooserIndex: 0,
    activeRole: null,
    activeRoleOwnerIndex: null,
    phase: { type: "chooseRole" },
    roles: roles.map((role, i) => ({
      id: `${role}-${i}`,
      role,
      doubloons: 0,
      taken: false,
    })),
    plantationDeck: deck,
    plantationDiscard: [],
    faceUpPlantations: [],
    quarrySupply: 8,
    colonistSupply: colonists - playerCount - shipColonists,
    colonistShip: shipColonists,
    tradingHouse: [],
    ships: shipCapacities(playerCount).map((capacity) => ({
      capacity,
      good: null,
      loaded: 0,
    })),
    vpSupply: vpChipCount(playerCount),
    buildingSupply: emptyBuildingSupply(),
    goodsSupply: { corn: 10, indigo: 11, sugar: 11, tobacco: 9, coffee: 9 },
    round: 1,
    gameOver: false,
    endTriggered: false,
    endReason: null,
    scores: null,
    log: [],
    logSeq: 0,
    rng,
    nextInstanceId: 1,
    difficulty: options.difficulty,
  };

  // Starting colonists on plantations came from the supply (already subtracted playerCount).
  refillFaceUp(state);
  state.log = [
    {
      id: 1,
      text: `第 1 輪開始。總督是${state.players[0]!.name}。請選擇角色。`,
    },
  ];
  state.logSeq = 1;
  return state;
}
