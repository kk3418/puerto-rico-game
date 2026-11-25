import type { Server } from "socket.io";
import type { Action } from "../../../src/engine";
import type { RedactedGameState } from "./redact";
import type { MatchOverPayload, SeatReplacedPayload, VoteView } from "./types";

let gameIo: Server | null = null;

export function roomName(matchId: string): string {
  return `match:${matchId}`;
}

export function setGameIo(io: Server | null): void {
  gameIo = io;
}

export function broadcastMatchState(
  matchId: string,
  payload: {
    state: RedactedGameState;
    legalActions: Action[];
    eventCount: number;
    vote: VoteView | null;
  },
): void {
  gameIo?.to(roomName(matchId)).emit("game:state", { matchId, ...payload });
}

export function broadcastVote(matchId: string, vote: VoteView): void {
  gameIo?.to(roomName(matchId)).emit("game:vote", { matchId, vote });
}

export function broadcastMatchOver(matchId: string, payload: MatchOverPayload): void {
  gameIo?.to(roomName(matchId)).emit("game:over", payload);
}

export function broadcastSeatReplaced(matchId: string, payload: SeatReplacedPayload): void {
  gameIo?.to(roomName(matchId)).emit("game:seat", payload);
}
