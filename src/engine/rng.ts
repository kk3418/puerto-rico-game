/** Mulberry32 — deterministic RNG stored as a plain number on GameState. */
export function nextUnit(rng: number): { value: number; rng: number } {
  let t = (rng + 0x6d2b79f5) >>> 0;
  const next = t;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { value, rng: next };
}

export function shuffleInPlace<T>(items: T[], rng: number): number {
  for (let i = items.length - 1; i > 0; i--) {
    const step = nextUnit(rng);
    rng = step.rng;
    const j = Math.floor(step.value * (i + 1));
    const tmp = items[i]!;
    items[i] = items[j]!;
    items[j] = tmp;
  }
  return rng;
}
