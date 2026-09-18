import type { SessionIdentity } from "../identity";

export type MatchAccessRow = {
  participants: Array<{
    userId: string | null;
    guestId: string | null;
    isHuman: boolean;
  }>;
};

export function canAccessMatch(match: MatchAccessRow, identity: SessionIdentity): boolean {
  return match.participants.some(
    (p) =>
      (identity.userId && p.userId === identity.userId) ||
      (identity.guestId && p.guestId === identity.guestId),
  );
}
