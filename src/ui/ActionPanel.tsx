import type { Action } from "../engine";
import { getBuilding } from "../engine";
import { GOOD_ZH, ROLE_ZH } from "./labels";
import type { Role } from "../engine/types";
import { GameIcon } from "./icons";

export function ActionPanel({
  legal,
  onAct,
  busy,
  prompt,
  activeRole,
  roleOwnerName,
}: {
  legal: Action[];
  onAct: (action: Action) => void;
  busy: boolean;
  prompt: string;
  activeRole?: Role | null;
  roleOwnerName?: string | null;
}) {
  const leftover = legal.filter((a) => !isBoardMapped(a));
  return (
    <aside className="action-panel">
      {activeRole && (
        <p className="action-role">
          <GameIcon kind={activeRole} size={22} />
          <strong>{ROLE_ZH[activeRole]}</strong>
          {roleOwnerName && <span className="action-role-owner">{roleOwnerName} 選</span>}
        </p>
      )}
      <h2>
        {prompt}
        {legal.length > 0 && <span className="legal-count"> · {legal.length} 個選擇</span>}
      </h2>
      {busy && <p className="thinking">對手行動中…</p>}
      <div className="act-list">
        {leftover.map((action, i) => (
          <button key={i} disabled={busy} onClick={() => onAct(action)}>
            {describe(action)}
          </button>
        ))}
      </div>
    </aside>
  );
}

function isBoardMapped(action: Action): boolean {
  if (action.type === "chooseRole") return true;
  if (action.type === "settlerTake" && action.source !== "pass") return true;
  if (action.type === "builderBuild" && action.buildingId) return true;
  if (action.type === "mayorPlace" && action.target.kind !== "sanJuan") return true;
  if (action.type === "mayorRemove") return true;
  if (action.type === "traderSell" && action.good) return true;
  if (action.type === "craftsmanExtra" && action.good) return true;
  if (action.type === "captainLoad") return true;
  return false;
}

function describe(action: Action): string {
  switch (action.type) {
    case "chooseRole":
      return ROLE_ZH[action.roleId.split("-")[0] as Role] ?? action.roleId;
    case "settlerHacienda":
      return action.take ? "莊園抽地" : "不用莊園";
    case "settlerTake":
      return "不拿種植園";
    case "mayorPlace":
      return "放到聖胡安";
    case "mayorDone":
      return "安置完成";
    case "builderBuild":
      return action.buildingId ? `建造${getBuilding(action.buildingId).nameZh}` : "不建造";
    case "craftsmanExtra":
      return action.good ? `多拿${GOOD_ZH[action.good]}` : "不多拿";
    case "traderSell":
      return action.good ? `賣${GOOD_ZH[action.good]}` : "不賣";
    case "captainPass":
      return "不裝船";
    case "captainStore": {
      const types = action.keepTypes.map((g) => GOOD_ZH[g]).join("、") || "無整類";
      const extra = action.extra ? `＋1 ${GOOD_ZH[action.extra]}` : "";
      return `保留${types}${extra}`;
    }
    default:
      return action.type;
  }
}
