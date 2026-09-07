import { BUILDING_IDS, canBuild, getBuilding, type Action, type GameState } from "../engine";
import { GOOD_TONE, GOOD_ZH, ROLE_ZH, TILE_ZH } from "./labels";
import type { Good, Role } from "../engine/types";

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
          return (
            <button
              key={slot.id}
              type="button"
              className={`role-tile ${slot.taken ? "taken" : ""} ${action ? "lit" : ""}`}
              disabled={!humanTurn || !action}
              onClick={() => action && onAct(action)}
            >
              <strong>{ROLE_ZH[slot.role as Role]}</strong>
              {slot.doubloons > 0 && <span className="coin">{slot.doubloons} 金</span>}
            </button>
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
                  {TILE_ZH[tile]}
                </button>
              );
            })}
            {legal.some((a) => a.type === "settlerTake" && a.source === "quarry") && (
              <button
                className="crop lit"
                style={{ background: GOOD_TONE.quarry }}
                onClick={() => onAct({ type: "settlerTake", source: "quarry" })}
              >
                採石場（{state.quarrySupply}）
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
                  <span>
                    {ship.capacity} 艙 · {ship.good ? `${GOOD_ZH[ship.good]} ${ship.loaded}` : "空船"}
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
              <span key={i} className="barrel" style={{ background: GOOD_TONE[g] }}>
                {GOOD_ZH[g]}
              </span>
            ))}
          </div>
        </div>

        <div className="meta-supply">
          <p>殖民船 {state.colonistShip}</p>
          <p>殖民者供應 {state.colonistSupply}</p>
          <p>勝利分籌碼 {state.vpSupply}</p>
          <p>
            貨物供應{" "}
            {(Object.keys(GOOD_ZH) as Good[]).map((g) => `${GOOD_ZH[g]}${state.goodsSupply[g]}`).join(" · ")}
          </p>
        </div>
      </div>

      <div className="market">
        <h2>建築市場</h2>
        <div className="market-grid">
          {BUILDING_IDS.map((id) => {
            const def = getBuilding(id);
            const action = legal.find((a) => a.type === "builderBuild" && a.buildingId === id);
            const phase = state.phase;
            const builderPhase = phase.type === "builder";
            const actor = builderPhase ? state.players[phase.actorIndex] : undefined;
            const privilege = builderPhase && phase.actorIndex === state.activeRoleOwnerIndex;
            const affordable = !!(actor && humanTurn && canBuild(state, actor, id, privilege));
            const enabled = !!(humanTurn && (action || affordable));
            return (
              <button
                key={id}
                type="button"
                className={`market-item ${def.kind} ${enabled ? "lit" : ""}`}
                disabled={!enabled}
                onClick={() => onAct(action ?? { type: "builderBuild", buildingId: id })}
              >
                <b>{def.nameZh}</b>
                <span>
                  {def.cost}金 · {def.vp}分 · 剩{state.buildingSupply[id]}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
