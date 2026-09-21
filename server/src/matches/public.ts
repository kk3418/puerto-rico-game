export function publicSeed(mode: string, seed: number): number | null {
  return mode === "solo" ? seed : null;
}

export function canReadMatchSave(save: { consentRequired: boolean }): boolean {
  return !save.consentRequired;
}
