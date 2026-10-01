import { api } from "./client";
import type { PlayerCount } from "../engine";

export type RoomSeat = {
  seatIndex: number;
  nickname: string;
  userId: string | null;
  guestId: string | null;
};

export type RoomSummary = {
  id: string;
  joinCode: string | null;
  playerCount: PlayerCount;
  status: string;
  hostSeatIndex: number;
  hostNickname: string | null;
  seatsTaken: number;
  startedAt: string;
  seats: RoomSeat[];
};

export type RoomListItem = {
  id: string;
  joinCode: string | null;
  playerCount: PlayerCount;
  hostNickname: string | null;
  seatsTaken: number;
  startedAt: string;
};

export function createRoom(input: { nickname: string; playerCount: PlayerCount }): Promise<RoomSummary> {
  return api<RoomSummary>("/rooms", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function listRooms(): Promise<{ rooms: RoomListItem[] }> {
  return api("/rooms");
}

export function joinRoom(input: {
  nickname: string;
  joinCode?: string;
  roomId?: string;
}): Promise<RoomSummary> {
  return api<RoomSummary>("/rooms/join", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function leaveRoom(id: string): Promise<{ room: RoomSummary | null }> {
  return api(`/rooms/${id}/leave`, { method: "POST" });
}

export function cancelRoom(id: string): Promise<{ room: RoomSummary | null }> {
  return api(`/rooms/${id}/cancel`, { method: "POST" });
}
