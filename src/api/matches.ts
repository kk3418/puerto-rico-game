import { api } from "./client";
import type { GameState } from "../engine";
import type { CreateMatchInput, FinishResult, MatchEventInput, MatchLiveState, MatchSave, MatchSummary, UserStats } from "./types";

export function createMatch(input: CreateMatchInput): Promise<MatchSummary> {
  return api<MatchSummary>("/matches", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function getMatch(id: string): Promise<MatchSummary> {
  return api<MatchSummary>(`/matches/${id}`);
}

export function getMatchState(id: string): Promise<MatchLiveState> {
  return api<MatchLiveState>(`/matches/${id}/state`);
}

export function postMatchEvents(
  id: string,
  events: MatchEventInput[],
  playToken: string,
): Promise<{ appended: number; eventCount: number }> {
  return api(`/matches/${id}/events`, {
    method: "POST",
    body: JSON.stringify({ playToken, events }),
  });
}

export function finishMatch(id: string): Promise<FinishResult> {
  return api<FinishResult>(`/matches/${id}/finish`, { method: "POST" });
}

export function abandonMatch(id: string): Promise<MatchSummary> {
  return api<MatchSummary>(`/matches/${id}/abandon`, { method: "POST" });
}

export function putMatchSave(id: string, state: GameState, schemaVersion = "1.0"): Promise<{
  matchId: string;
  schemaVersion: string;
  savedAt: string;
  consentRequired: boolean;
}> {
  return api(`/matches/${id}/save`, {
    method: "PUT",
    body: JSON.stringify({ state, schemaVersion }),
  });
}

export function getMatchSave(id: string): Promise<MatchSave> {
  return api<MatchSave>(`/matches/${id}/save`);
}

export function getMyMatches(): Promise<{ matches: MatchSummary[] }> {
  return api("/me/matches");
}

export function getMyStats(): Promise<UserStats> {
  return api("/me/stats");
}
