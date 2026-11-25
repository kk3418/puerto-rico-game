export type VoteChoice = "approve" | "oppose";

export type VoteResult = "passed" | "failed" | "abandoned";

export type VoteStatus = "open" | VoteResult;

export type VoteView = {
  id: string;
  matchId: string;
  status: VoteStatus;
  initiatedBySeat: number;
  createdAt: string;
  deadlineAt: string;
  resolvedAt: string | null;
  result: VoteResult | null;
  eligibleSeats: number[];
  ballots: Array<{ seatIndex: number; choice: VoteChoice }>;
  approve: number;
  oppose: number;
};

export type MatchOverPayload =
  | {
      matchId: string;
      status: "finished";
      scores: Array<{
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
        goodsAndGold: number;
      }>;
      endReason: string | null;
    }
  | { matchId: string; status: "abandoned" };

export type SeatReplacedPayload = {
  matchId: string;
  seatIndex: number;
  replacedByAi: true;
  reason: "leave" | "idle";
};
