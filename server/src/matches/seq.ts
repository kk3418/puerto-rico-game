export type SeqKind = "duplicate" | "next" | "gap";

export function classifySeq(seq: number, maxSeq: number): SeqKind {
  if (seq <= maxSeq) return "duplicate";
  if (seq === maxSeq + 1) return "next";
  return "gap";
}
