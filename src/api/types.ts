import type { Action, Difficulty, GameState, PlayerCount, ScoreBreakdown } from "../engine";

export type AuthUser = {
  id: string;
  email: string | null;
  displayName: string;
  avatarUrl: string | null;
};

export type AuthGuest = {
  id: string;
  nickname: string | null;
};

export type AuthMe = {
  user: AuthUser | null;
  guest: AuthGuest | null;
  authenticated: boolean;
  providers?: {
    google: boolean;
    github: boolean;
  };
};

export type ParticipantScore = {
  vpChips: number;
  buildingVp: number;
  guildHall: number;
  residence: number;
  fortress: number;
  customsHouse: number;
  cityHall: number;
  total: number;
  goodsAndGold: number;
};

export type MatchSummary = {
  id: string;
  mode: string;
  playerCount: PlayerCount;
  difficulty: Difficulty;
  seed: number | null;
  humanName: string;
  endReason: string | null;
  startedAt: string;
  endedAt: string | null;
  status: "lobby" | "playing" | "finished" | "abandoned";
  verified: boolean;
  eventCount: number;
  hasSave: boolean;
  playToken?: string | null;
  joinCode?: string | null;
  hostSeatIndex?: number | null;
  participants: Array<{
    seatIndex: number;
    nickname: string;
    userId: string | null;
    guestId: string | null;
    isHuman: boolean;
    isAi: boolean;
    replacedByAiAt?: string | null;
    scores: ParticipantScore | null;
  }>;
};

export type FinishResult = MatchSummary & {
  scores: ScoreBreakdown[];
  endReason: string | null;
};

export type UserStats = {
  gamesPlayed: number;
  gamesWon: number;
  totalScore: number;
  bestScore: number;
  lastPlayedAt: string | null;
};

export type MatchEventInput = {
  seq: number;
  round: number;
  phaseType?: string;
  activeRole?: string | null;
  actorSeatIndex: number;
  action: unknown;
};

export type MatchLiveState = MatchSummary & {
  state: GameState;
  playToken?: string;
  legalActions?: Action[];
  seatIndex?: number;
  vote?: OnlineVoteView | null;
};

export type MatchSave = {
  matchId: string;
  schemaVersion: string;
  savedAt: string;
  consentRequired: boolean;
  state: GameState;
};

export type CreateMatchInput = {
  nickname: string;
  playerCount: PlayerCount;
  difficulty: Difficulty;
  seed?: number;
};

export type VoteChoice = "approve" | "oppose";

export type OnlineVoteView = {
  id: string;
  matchId: string;
  status: "open" | "passed" | "failed" | "abandoned";
  initiatedBySeat: number;
  createdAt: string;
  deadlineAt: string;
  resolvedAt: string | null;
  result: "passed" | "failed" | "abandoned" | null;
  eligibleSeats: number[];
  ballots: Array<{ seatIndex: number; choice: VoteChoice }>;
  approve: number;
  oppose: number;
};

/** Online socket payloads. `state` is redacted server-side (no deck contents or rng). */
export type OnlineStatePayload = {
  matchId: string;
  state: GameState;
  legalActions: Action[];
  eventCount: number;
  seatIndex?: number;
  vote?: OnlineVoteView | null;
};

export type OnlineVotePayload = {
  matchId: string;
  vote: OnlineVoteView;
};

export type OnlineSeatPayload = {
  matchId: string;
  seatIndex: number;
  replacedByAi: true;
  reason: "leave" | "idle";
};

export type OnlineOverPayload = {
  matchId: string;
  status: string;
  scores?: ScoreBreakdown[];
  endReason?: string | null;
};

export type OnlineErrorPayload = {
  error: string;
  code?: string;
  params?: Record<string, string | number>;
};
