import { beginBuilder } from "./roles/builder";
import { beginCaptain } from "./roles/captain";
import { beginCraftsman } from "./roles/craftsman";
import { beginMayor } from "./roles/mayor";
import { beginProspector } from "./roles/prospector";
import { beginSettler } from "./roles/settler";
import { beginTrader } from "./roles/trader";
import type { GameState, Role } from "./types";

export function beginChosenRole(state: GameState, role: Role, ownerIndex: number): void {
  state.activeRole = role;
  state.activeRoleOwnerIndex = ownerIndex;
  switch (role) {
    case "settler":
      beginSettler(state, ownerIndex);
      break;
    case "mayor":
      beginMayor(state, ownerIndex);
      break;
    case "builder":
      beginBuilder(state, ownerIndex);
      break;
    case "craftsman":
      beginCraftsman(state, ownerIndex);
      break;
    case "trader":
      beginTrader(state, ownerIndex);
      break;
    case "captain":
      beginCaptain(state, ownerIndex);
      break;
    case "prospector":
      beginProspector(state, ownerIndex);
      break;
  }
}
