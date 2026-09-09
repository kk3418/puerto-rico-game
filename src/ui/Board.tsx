import { BUILDING_IDS, canBuild, getBuilding, type Action, type GameState } from "../engine";
import { GOOD_TONE, GOOD_ZH, ROLE_ZH, TILE_ZH } from "./labels";
import type { Good, Role } from "../engine/types";
import { GameIcon } from "./icons";
import { Tooltip } from "./Tooltip";
import { BUILDING_TIP, ROLE_TIP } from "./tooltips";

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
  return (
    <section className="public-board">
      <div className="role-row">
        {state.roles.map((slot) => {
          const action = legal.find((a) => a.type === "chooseRole" && a.roleId === slot.id);
          const role = slot.role as Role;
          return (
            <Tooltip key={slot.id} content={ROLE_TIP[role]}>
              <button
                type="button"
                className={`role-tile ${slot.taken ? "taken" : ""} ${action ? "lit" : ""}`}
                disabled={!humanTurn || !action}
                onClick={() => action && onAct(action)}
              >
                <span className="icon-label role-label"><GameIcon kind={role} size={40} /><strong>{ROLE_ZH[role]}</strong></span>
                {slot.doubloons > 0 && <span className="coin"><GameIcon kind="coin" size={15} />{slot.doubloons}</span>}
              </button>
            </Tooltip>
          );
        })}
      </div>

      <div className="supply-row">
        <div>
          <h2>公開種植園</h2>
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
                  <span className="icon-label"><GameIcon kind={tile} size={26} />{TILE_ZH[tile]}</span>
                </button>
              );
            })}
            {legal.some((a) => a.type === "settlerTake" && a.source === "quarry") && (
              <button
                className="crop lit"
                style={{ background: GOOD_TONE.quarry }}
                onClick={() => onAct({ type: "settlerTake", source: "quarry" })}
              >
                <span className="icon-label"><GameIcon kind="quarry" size={26} />採石場</span>
                <span className="tile-count">×{state.quarrySupply}</span>
              </button>
            )}
          </div>
        </div>

        <div>
          <h2>貨船</h2>
          <div className="tile-row">
            {state.ships.map((ship, index) => {
              const loads = legal.filter((a) => a.type === "captainLoad" && a.destination === index);
              return (
                <div key={index} className={`ship ${loads.length ? "lit" : ""}`}>
                  <span className="icon-label">
                    <GameIcon kind="ship" />
                    {ship.capacity} 艙
                    {ship.good ? <><GameIcon kind={ship.good} size={24} />{ship.loaded}</> : " · 空船"}
                  </span>
                  {loads.map((a) =>
                    a.type === "captainLoad" ? (
                      <button key={a.good} onClick={() => onAct(a)}>
                        裝{GOOD_ZH[a.good]}
                      </button>
                    ) : null,
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div>
          <h2>交易屋 {state.tradingHouse.length}/4</h2>
          <div className="tile-row">
            {state.tradingHouse.map((g, i) => (
              <span key={i} className="barrel icon-label" style={{ background: GOOD_TONE[g] }}>
                <GameIcon kind={g} size={26} />{GOOD_ZH[g]}
              </span>
            ))}
          </div>
        </div>

        <div className="meta-supply">
          <p className="icon-label"><GameIcon kind="ship" />殖民船 <b>{state.colonistShip}</b></p>
          <p className="icon-label"><GameIcon kind="colonist" />供應 <b>{state.colonistSupply}</b></p>
          <p className="icon-label"><GameIcon kind="vp" />供應 <b>{state.vpSupply}</b></p>
          <div className="goods-supply" aria-label="貨物供應">
            {(Object.keys(GOOD_ZH) as Good[]).map((g) => (
              <span key={g} className="icon-label" title={`${GOOD_ZH[g]}供應`}>
                <GameIcon kind={g} size={24} /><b>{state.goodsSupply[g]}</b>
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="market">
        <h2>建築市場</h2>
        {[1, 2, 3, 4].map((quarryColumn) => (
          <div key={quarryColumn} className="market-row">
            <span className="market-row-label" title={`最多 ${quarryColumn} 座採石場折扣`}>
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
                  <Tooltip key={id} content={BUILDING_TIP[id]}>
                    <button
                      type="button"
                      className={`market-item ${def.kind} ${enabled ? "lit" : ""}`}
                      disabled={!enabled}
                      onClick={() => onAct(action ?? { type: "builderBuild", buildingId: id })}
                    >
                      <b>{def.nameZh}</b>
                      <span className="market-stats">
                        <span className="icon-label"><GameIcon kind="coin" size={14} />{def.cost}</span>
                        <span className="icon-label"><GameIcon kind="vp" size={14} />{def.vp}</span>
                        <span>剩 {state.buildingSupply[id]}</span>
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
