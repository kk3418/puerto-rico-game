export function publicSeed(mode: string, seed: number): number | null {
  return mode === "solo" ? seed : null;
}

export function canReadMatchSave(input: {
  mode: string;
  save: { consentRequired: boolean } | null;
  participants: Array<{ seatIndex: number; isHuman: boolean }>;
  consents: Array<{ seatIndex: number }>;
}): boolean {
  if (input.mode === "online") {
    const consented = new Set(input.consents.map((c) => c.seatIndex));
    const humanSeats = input.participants.filter((p) => p.isHuman);
    return humanSeats.length > 0 && humanSeats.every((p) => consented.has(p.seatIndex));
  }
  return !input.save?.consentRequired;
}
