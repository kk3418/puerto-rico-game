import type { Difficulty, GameState, PlayerCount, ScoreBreakdown } from "../engine";

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
};

export type MatchSummary = {
  id: string;
  mode: string;
  playerCount: PlayerCount;
  difficulty: Difficulty;
  seed: number;
  humanName: string;
  endReason: string | null;
  startedAt: string;
  endedAt: string | null;
  status: "playing" | "finished" | "abandoned";
  verified: boolean;
  eventCount: number;
  hasSave: boolean;
  participants: Array<{
    seatIndex: number;
    nickname: string;
    userId: string | null;
    guestId: string | null;
    isHuman: boolean;
    isAi: boolean;
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
