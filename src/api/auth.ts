import { api } from "./client";
import type { AuthMe } from "./types";

const NICK_KEY = "pr.nickname";
const MATCH_KEY = "pr.lastMatchId";

export function readStoredNickname(): string {
  return localStorage.getItem(NICK_KEY) ?? "";
}

export function writeStoredNickname(nickname: string): void {
  localStorage.setItem(NICK_KEY, nickname);
}

export function readLastMatchId(): string | null {
  return localStorage.getItem(MATCH_KEY);
}

export function writeLastMatchId(matchId: string): void {
  localStorage.setItem(MATCH_KEY, matchId);
}

export function clearLastMatchId(): void {
  localStorage.removeItem(MATCH_KEY);
}

export function getMe(): Promise<AuthMe> {
  return api<AuthMe>("/auth/me");
}

export function createGuest(nickname?: string): Promise<AuthMe> {
  return api<AuthMe>("/auth/guest", {
    method: "POST",
    body: JSON.stringify(nickname ? { nickname } : {}),
  });
}

export function loginWithGoogle(idToken: string): Promise<AuthMe> {
  return api<AuthMe>("/auth/google", {
    method: "POST",
    body: JSON.stringify({ idToken }),
  });
}

export function logout(): Promise<{ ok: boolean }> {
  return api<{ ok: boolean }>("/auth/logout", { method: "POST" });
}

export function githubLoginUrl(): string {
  return "/api/auth/github";
}
