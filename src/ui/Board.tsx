import { BUILDING_IDS, canBuild, getBuilding, type Action, type GameState } from "../engine";
import { GOODS, type Role } from "../engine/types";
import { buildingName, GOOD_TONE, goodName, roleName, tileName } from "./labels";
import { useTranslation } from "react-i18next";
import { GameIcon } from "./icons";
import { Tooltip } from "./Tooltip";
import { buildingTip, roleTip } from "./tooltips";

export function Board({
  state,
  legal,
  onAct,
  humanTurn,
}: {
  state: GameState;
  legal: Action[];
  onAct: (action: Action) => void;
  humanTurn: boolean;
}) {
  const { t } = useTranslation("game");
  return (
    <section className="public-board">
      <div className={`role-row roles-${state.roles.length}`}>
        {state.roles.map((slot) => {
          const action = legal.find((a) => a.type === "chooseRole" && a.roleId === slot.id);
          const role = slot.role as Role;
          return (
            <Tooltip key={slot.id} content={roleTip(role)}>
              <button
                type="button"
                className={`role-tile ${slot.taken ? "taken" : ""} ${action ? "lit" : ""}`}
                disabled={!humanTurn || !action}
                onClick={() => action && onAct(action)}
              >
                <span className="icon-label role-label">
                  <GameIcon kind={role} size={40} />
                  <strong>{roleName(role)}</strong>
                </span>
                {slot.doubloons > 0 && (
                  <span className="coin">
                    <GameIcon kind="coin" size={15} />
                    {slot.doubloons}
                  </span>
                )}
              </button>
            </Tooltip>
          );
        })}
      </div>

      <div className="supply-row">
        <div>
          <h2>{t("publicPlantations")}</h2>
          <div className="tile-row">
            {state.faceUpPlantations.map((tile, index) => {
              const action = legal.find((a) => a.type === "settlerTake" && a.source === "faceUp" && a.index === index);
              return (
                <button
                  key={`${tile}-${index}`}
                  className={`crop ${action ? "lit" : ""}`}
                  style={{ background: GOOD_TONE[tile] }}
                  disabled={!humanTurn || !action}
                  onClick={() => action && onAct(action)}
                >
                  <span className="icon-label">
                    <GameIcon kind={tile} size={26} />
                    {tileName(tile)}
                  </span>
                </button>
              );
            })}
            {legal.some((a) => a.type === "settlerTake" && a.source === "quarry") && (
              <button
                className="crop lit"
                style={{ background: GOOD_TONE.quarry }}
                onClick={() => onAct({ type: "settlerTake", source: "quarry" })}
              >
                <span className="icon-label">
                  <GameIcon kind="quarry" size={26} />
                  {t("quarry")}
                </span>
                <span className="tile-count">×{state.quarrySupply}</span>
              </button>
            )}
          </div>
        </div>

        <div>
          <h2>{t("cargoShips")}</h2>
          <div className="tile-row">
            {state.ships.map((ship, index) => {
              const loads = legal.filter((a) => a.type === "captainLoad" && a.destination === index);
              return (
                <div key={index} className={`ship ${loads.length ? "lit" : ""}`}>
                  <span className="icon-label">
                    <GameIcon kind="ship" />
                    {t("holds", { n: ship.capacity })}
                    {ship.good ? (
                      <>
                        <GameIcon kind={ship.good} size={24} />
                        {ship.loaded}
                      </>
                    ) : (
                      t("emptyShip")
                    )}
                  </span>
                  {loads.map((a) =>
                    a.type === "captainLoad" ? (
                      <button key={a.good} onClick={() => onAct(a)}>
                        {t("loadGood", { good: goodName(a.good) })}
                      </button>
                    ) : null,
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div>
          <h2>{t("tradingHouse", { count: state.tradingHouse.length })}</h2>
          <div className="tile-row">
            {state.tradingHouse.map((g, i) => (
              <span key={i} className="barrel icon-label" style={{ background: GOOD_TONE[g] }}>
                <GameIcon kind={g} size={26} />
                {goodName(g)}
              </span>
            ))}
          </div>
        </div>

        <div className="meta-supply">
          <p className="icon-label">
            <GameIcon kind="ship" />
            {t("colonistShip")} <b>{state.colonistShip}</b>
          </p>
          <p className="icon-label">
            <GameIcon kind="colonist" />
            {t("supply")} <b>{state.colonistSupply}</b>
          </p>
          <p className="icon-label">
            <GameIcon kind="vp" />
            {t("supply")} <b>{state.vpSupply}</b>
          </p>
          <div className="goods-supply" aria-label={t("goodsSupply")}>
            {GOODS.map((g) => (
              <span key={g} className="icon-label" title={t("goodSupply", { good: goodName(g) })}>
                <GameIcon kind={g} size={24} />
                <b>{state.goodsSupply[g]}</b>
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="market">
        <h2>{t("buildingMarket")}</h2>
        {[1, 2, 3, 4].map((quarryColumn) => (
          <div key={quarryColumn} className="market-row">
            <span className="market-row-label" title={t("quarryDiscount", { n: quarryColumn })}>
              <GameIcon kind="quarry" size={22} />
              ×{quarryColumn}
            </span>
            <div className="market-grid">
              {BUILDING_IDS.filter((id) => getBuilding(id).quarryColumn === quarryColumn).map((id) => {
                const def = getBuilding(id);
                const action = legal.find((a) => a.type === "builderBuild" && a.buildingId === id);
                const phase = state.phase;
                const builderPhase = phase.type === "builder";
                const actor = builderPhase ? state.players[phase.actorIndex] : undefined;
                const privilege = builderPhase && phase.actorIndex === state.activeRoleOwnerIndex;
                const affordable = !!(actor && humanTurn && canBuild(state, actor, id, privilege));
                const enabled = !!(humanTurn && (action || affordable));
                return (
                  <Tooltip key={id} content={buildingTip(id)}>
                    <button
                      type="button"
                      className={`market-item ${def.kind} ${enabled ? "lit" : ""}`}
                      disabled={!enabled}
                      onClick={() => onAct(action ?? { type: "builderBuild", buildingId: id })}
                    >
                      <b>{buildingName(id)}</b>
                      <span className="market-stats">
                        <span className="icon-label">
                          <GameIcon kind="coin" size={14} />
                          {def.cost}
                        </span>
                        <span className="icon-label">
                          <GameIcon kind="vp" size={14} />
                          {def.vp}
                        </span>
                        <span>{t("remaining", { n: state.buildingSupply[id] })}</span>
                      </span>
                    </button>
                  </Tooltip>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
