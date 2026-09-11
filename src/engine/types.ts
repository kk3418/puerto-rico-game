export const GOODS = ["corn", "indigo", "sugar", "tobacco", "coffee"] as const;
export type Good = (typeof GOODS)[number];

export type TileType = Good | "quarry";

export const ROLES = [
  "settler",
  "mayor",
  "builder",
  "craftsman",
  "trader",
  "captain",
  "prospector",
] as const;
export type Role = (typeof ROLES)[number];

export type BuildingId =
  | "smallIndigo"
  | "smallSugar"
  | "largeIndigo"
  | "largeSugar"
  | "tobaccoStorage"
  | "coffeeRoaster"
  | "smallMarket"
  | "hacienda"
  | "constructionHut"
  | "smallWarehouse"
  | "hospice"
  | "office"
  | "largeMarket"
  | "largeWarehouse"
  | "factory"
  | "university"
  | "harbor"
  | "wharf"
  | "guildHall"
  | "residence"
  | "fortress"
  | "customsHouse"
  | "cityHall";

export type BuildingKind = "productionSmall" | "productionLarge" | "violet" | "large";

export type Difficulty = "balanced" | "aggressive";

export type PlayerCount = 3 | 4 | 5;

export interface IslandTile {
  type: TileType;
  colonists: number;
}

export interface CityBuilding {
  instanceId: string;
  buildingId: BuildingId;
  colonists: number;
}

export interface PlayerState {
  id: string;
  name: string;
  isHuman: boolean;
  doubloons: number;
  vpChips: number;
  island: IslandTile[];
  city: CityBuilding[];
  goods: Record<Good, number>;
  sanJuan: number;
  unplacedColonists: number;
}

export interface CargoShip {
  capacity: number;
  good: Good | null;
  loaded: number;
}

export interface RoleSlot {
  id: string;
  role: Role;
  doubloons: number;
  taken: boolean;
  takenBy: number | null;
}

export interface LogEntry {
  id: number;
  text: string;
}

export interface ScoreBreakdown {
  playerId: string;
  name: string;
  vpChips: number;
  buildingVp: number;
  guildHall: number;
  residence: number;
  fortress: number;
  customsHouse: number;
  cityHall: number;
  total: number;
}

export type Phase =
  | { type: "chooseRole" }
  | { type: "settlerHacienda"; actorIndex: number }
  | { type: "settlerTake"; actorIndex: number }
  | { type: "mayorAssign"; actorIndex: number; received: number }
  | { type: "builder"; actorIndex: number }
  | { type: "craftsmanPrivilege"; actorIndex: number; produced: Good[] }
  | { type: "trader"; actorIndex: number }
  | {
      type: "captainLoad";
      actorIndex: number;
      passes: number;
      wharfUsed: string[];
      privilegeUsed: boolean;
    }
  | { type: "captainStore"; actorIndex: number; rest: number[] }
  | { type: "gameOver" };

export interface GameState {
  playerCount: PlayerCount;
  players: PlayerState[];
  governorIndex: number;
  chooserIndex: number;
  activeRole: Role | null;
  activeRoleOwnerIndex: number | null;
  phase: Phase;
  roles: RoleSlot[];
  plantationDeck: TileType[];
  plantationDiscard: TileType[];
  faceUpPlantations: TileType[];
  quarrySupply: number;
  colonistSupply: number;
  colonistShip: number;
  tradingHouse: Good[];
  ships: CargoShip[];
  vpSupply: number;
  buildingSupply: Record<BuildingId, number>;
  goodsSupply: Record<Good, number>;
  round: number;
  gameOver: boolean;
  endTriggered: boolean;
  endReason: string | null;
  scores: ScoreBreakdown[] | null;
  log: LogEntry[];
  logSeq: number;
  rng: number;
  nextInstanceId: number;
  difficulty: Difficulty;
}

export type Action =
  | { type: "chooseRole"; roleId: string }
  | { type: "settlerHacienda"; take: boolean }
  | { type: "settlerTake"; source: "faceUp"; index: number }
  | { type: "settlerTake"; source: "quarry" }
  | { type: "settlerTake"; source: "pass" }
  | {
      type: "mayorPlace";
      target: { kind: "island"; index: number } | { kind: "building"; instanceId: string } | { kind: "sanJuan" };
    }
  | {
      type: "mayorRemove";
      target: { kind: "island"; index: number } | { kind: "building"; instanceId: string };
    }
  | { type: "mayorDone" }
  | { type: "builderBuild"; buildingId: BuildingId }
  | { type: "builderBuild"; buildingId: null }
  | { type: "craftsmanExtra"; good: Good }
  | { type: "craftsmanExtra"; good: null }
  | { type: "traderSell"; good: Good }
  | { type: "traderSell"; good: null }
  | { type: "captainLoad"; good: Good; destination: number }
  | { type: "captainLoad"; good: Good; destination: "wharf" }
  | { type: "captainPass" }
  | { type: "captainStore"; keepTypes: Good[]; extra: Good | null };

export interface SetupOptions {
  playerCount: PlayerCount;
  difficulty: Difficulty;
  seed?: number;
  humanName?: string;
  /** When omitted, the first governor is chosen from the seed/RNG. */
  governorIndex?: number;
}
