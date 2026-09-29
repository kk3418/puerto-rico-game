import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import type { Action } from "../engine";
import i18n from "../i18n";
import { buildingName, goodName, roleName } from "./labels";
import type { Role } from "../engine/types";
import { GameIcon } from "./icons";
import { Tooltip } from "./Tooltip";

export function mayorConfirmBlocked(): string {
  return i18n.t("mayorBlocked", { ns: "game" });
}

export function ActionPanel({
  legal,
  onAct,
  busy,
  prompt,
  activeRole,
  roleOwnerName,
  phaseType,
}: {
  legal: Action[];
  onAct: (action: Action) => void;
  busy: boolean;
  prompt: string;
  activeRole?: Role | null;
  roleOwnerName?: string | null;
  phaseType?: string;
}) {
  const { t } = useTranslation("game");
  const leftover = legal.filter((a) => !isBoardMapped(a) && a.type !== "mayorDone");
  const mayorDone = legal.find((a) => a.type === "mayorDone");
  const mayorTurn =
    phaseType === "mayorAssign" ||
    legal.some((a) => a.type === "mayorPlace" || a.type === "mayorRemove" || a.type === "mayorDone");
  const mayorBlocked = mayorTurn && !busy && !mayorDone ? t("mayorBlocked") : null;
  const confirmDisabled = busy || !mayorDone;
  const confirmButton = (
    <button
      type="button"
      className="act-confirm"
      disabled={confirmDisabled}
      onClick={() => mayorDone && onAct(mayorDone)}
      aria-label={mayorBlocked ? t("confirmAriaBlocked", { reason: mayorBlocked }) : t("confirm")}
    >
      {t("confirm")}
    </button>
  );
  return (
    <aside className="action-panel">
      {activeRole && (
        <p className="action-role">
          <GameIcon kind={activeRole} size={22} />
          <strong>{roleName(activeRole)}</strong>
          {roleOwnerName && <span className="action-role-owner">{t("roleChosenBy", { name: roleOwnerName })}</span>}
        </p>
      )}
      <h2>
        {prompt}
        {legal.length > 0 && <span className="legal-count">{t("choiceCount", { count: legal.length })}</span>}
      </h2>
      {busy && <p className="thinking">{t("opponentActing")}</p>}
      <div className="act-list">
        {leftover.map((action, i) => (
          <button key={i} disabled={busy} onClick={() => onAct(action)}>
            {describe(action, t)}
          </button>
        ))}
        {mayorTurn &&
          (mayorBlocked ? (
            <Tooltip content={mayorBlocked} className="act-confirm-wrap">
              {confirmButton}
            </Tooltip>
          ) : (
            confirmButton
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

function describe(action: Action, t: TFunction): string {
  switch (action.type) {
    case "chooseRole":
      return roleName(action.roleId.split("-")[0] as Role) || action.roleId;
    case "settlerHacienda":
      return action.take ? t("haciendaDraw") : t("skipHacienda");
    case "settlerTake":
      return t("skipPlantation");
    case "mayorPlace":
      return t("toSanJuan");
    case "mayorDone":
      return t("confirm");
    case "builderBuild":
      return action.buildingId ? t("buildBuilding", { building: buildingName(action.buildingId) }) : t("skipBuild");
    case "craftsmanExtra":
      return action.good ? t("takeExtraGood", { good: goodName(action.good) }) : t("skipExtra");
    case "traderSell":
      return action.good ? t("sellGood", { good: goodName(action.good) }) : t("skipSell");
    case "captainPass":
      return t("skipShip");
    case "captainStore": {
      const types = action.keepTypes.map((g) => goodName(g)).join(t("listJoin")) || t("keepNone");
      const extra = action.extra ? t("keepExtra", { good: goodName(action.extra) }) : "";
      return t("keepGoods", { types, extra });
    }
    default:
      return action.type;
  }
}
