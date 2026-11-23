/**
 * How long the server should wait before the next AI action.
 *
 * Sub-actions inside the same phase for the same AI seat (for example, placing
 * several colonists before pressing Confirm) run back-to-back. The configured
 * delay is only applied when the AI finishes its part of a phase: the phase
 * type changes, the actor changes, or the match ends.
 */
export function aiDelayAfterAction(input: {
  seatIndex: number;
  beforePhaseType: string;
  nextActorIndex: number | null;
  nextPhaseType: string;
  baseDelay: number;
}): number {
  const continuesSamePhase =
    input.nextActorIndex === input.seatIndex && input.nextPhaseType === input.beforePhaseType;
  return continuesSamePhase ? 0 : input.baseDelay;
}
