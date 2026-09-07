import { applyAction, getActorIndex, getLegalActions, isLegalAction } from "../engine";
import type { Action, GameState } from "../engine/types";
import type { PlayerAgent } from "./types";

export class IllegalAgentActionError extends Error {
  constructor(public readonly action: Action) {
    super(`Agent returned illegal action: ${JSON.stringify(action)}`);
    this.name = "IllegalAgentActionError";
  }
}

export async function dispatchAction(
  state: GameState,
  action: Action,
  expectedPlayerId?: string,
): Promise<GameState> {
  const legal = getLegalActions(state);
  if (!isLegalAction(state, action, legal)) {
    throw new IllegalAgentActionError(action);
  }
  const idx = getActorIndex(state);
  if (expectedPlayerId && idx !== null && state.players[idx]?.id !== expectedPlayerId) {
    throw new Error("Action played out of turn");
  }
  return applyAction(state, action);
}

export async function playUntilHuman(
  state: GameState,
  agents: Record<string, PlayerAgent>,
  onChange: (next: GameState) => void,
  aiDelayMs = 280,
): Promise<GameState> {
  let current = state;
  while (!current.gameOver) {
    const idx = getActorIndex(current);
    if (idx === null) break;
    const player = current.players[idx]!;
    if (player.isHuman) return current;
    const legal = getLegalActions(current);
    if (legal.length === 0) {
      throw new Error(`No legal actions for ${player.name} in ${current.phase.type}`);
    }
    const agent = agents[player.id];
    if (!agent) throw new Error(`Missing agent for ${player.id}`);
    const action = await agent.chooseAction({
      state: current,
      legalActions: legal,
      playerId: player.id,
    });
    current = await dispatchAction(current, action, player.id);
    onChange(current);
    if (aiDelayMs > 0) {
      await sleep(aiDelayMs);
    }
  }
  return current;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
