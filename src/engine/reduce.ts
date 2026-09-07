import { beginChosenRole } from "./flow";
import { actorIndex, actionsEqual, cloneState, isLegalAction, pushLog } from "./helpers";
import { applyBuilder, legalBuilder } from "./roles/builder";
import { applyCaptain, legalCaptain } from "./roles/captain";
import { applyCraftsman, legalCraftsman } from "./roles/craftsman";
import { applyMayor, legalMayor } from "./roles/mayor";
import { applySettler, legalSettler } from "./roles/settler";
import { applyTrader, legalTrader } from "./roles/trader";
import type { Action, GameState } from "./types";

export function getActorIndex(state: GameState): number | null {
  return actorIndex(state);
}

export function getLegalActions(state: GameState): Action[] {
  if (state.gameOver || state.phase.type === "gameOver") return [];
  switch (state.phase.type) {
    case "chooseRole":
      return state.roles
        .filter((slot) => !slot.taken)
        .map((slot) => ({ type: "chooseRole" as const, roleId: slot.id }));
    case "settlerHacienda":
    case "settlerTake":
      return legalSettler(state);
    case "mayorAssign":
      return legalMayor(state);
    case "builder":
      return legalBuilder(state);
    case "craftsmanPrivilege":
      return legalCraftsman(state);
    case "trader":
      return legalTrader(state);
    case "captainLoad":
    case "captainStore":
      return legalCaptain(state);
    default:
      return [];
  }
}

export function applyAction(state: GameState, action: Action): GameState {
  const next = cloneState(state);
  const legal = getLegalActions(next);
  if (!isLegalAction(next, action, legal)) {
    throw new Error(`Illegal action: ${JSON.stringify(action)}`);
  }

  switch (action.type) {
    case "chooseRole": {
      const slot = next.roles.find((r) => r.id === action.roleId);
      if (!slot) throw new Error("Unknown role");
      const chooser = next.players[next.chooserIndex]!;
      chooser.doubloons += slot.doubloons;
      const bonus = slot.doubloons;
      slot.doubloons = 0;
      slot.taken = true;
      const bonusText = bonus > 0 ? `並拿取牌上 ${bonus} 金幣` : "";
      pushLog(next, `${chooser.name}選擇了${roleLabel(slot.role)}${bonusText}。`);
      beginChosenRole(next, slot.role, next.chooserIndex);
      break;
    }
    case "settlerHacienda":
    case "settlerTake":
      applySettler(next, action);
      break;
    case "mayorPlace":
    case "mayorDone":
      applyMayor(next, action);
      break;
    case "builderBuild":
      applyBuilder(next, action);
      break;
    case "craftsmanExtra":
      applyCraftsman(next, action);
      break;
    case "traderSell":
      applyTrader(next, action);
      break;
    case "captainLoad":
    case "captainPass":
    case "captainStore":
      applyCaptain(next, action);
      break;
    default:
      break;
  }

  return next;
}

export function roleLabel(role: string): string {
  const labels: Record<string, string> = {
    settler: "拓荒者",
    mayor: "市長",
    builder: "建築師",
    craftsman: "工匠",
    trader: "商人",
    captain: "船長",
    prospector: "淘金者",
  };
  return labels[role] ?? role;
}

export { actionsEqual };
