import { pushLog } from "./helpers";
import { scoreGame } from "./scoring";
import type { GameState } from "./types";

export function completeRole(state: GameState): void {
  state.activeRole = null;
  state.activeRoleOwnerIndex = null;
  const chosen = state.roles.filter((r) => r.taken).length;
  if (chosen >= state.playerCount) {
    endGovernorRound(state);
    return;
  }
  state.chooserIndex = (state.chooserIndex + 1) % state.players.length;
  state.phase = { type: "chooseRole" };
  const chooser = state.players[state.chooserIndex]!;
  pushLog(state, "chooseRolePrompt", { player: chooser.name });
}

function endGovernorRound(state: GameState): void {
  for (const slot of state.roles) {
    if (!slot.taken) slot.doubloons += 1;
    slot.taken = false;
    slot.takenBy = null;
  }
  if (state.endTriggered) {
    finishGame(state);
    return;
  }
  state.governorIndex = (state.governorIndex + 1) % state.players.length;
  state.chooserIndex = state.governorIndex;
  state.round += 1;
  state.phase = { type: "chooseRole" };
  const gov = state.players[state.governorIndex]!;
  pushLog(state, "newRound", { round: state.round, governor: gov.name });
}

export function finishGame(state: GameState): void {
  state.gameOver = true;
  state.phase = { type: "gameOver" };
  state.scores = scoreGame(state);
  const winner = state.scores[0];
  if (winner) {
    pushLog(state, "gameOver", { player: winner.name, score: winner.total });
  } else {
    pushLog(state, "gameOverNoWinner");
  }
}
