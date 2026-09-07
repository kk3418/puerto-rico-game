import { getBuilding, type Action, type PlayerState } from "../engine";
import { GOOD_TONE, GOOD_ZH, TILE_ZH } from "./labels";
import type { Good } from "../engine/types";

export function PlayerBoard({
  player,
  self,
  legal,
  onAct,
  humanTurn,
  hideVp,
}: {
  player: PlayerState;
  self: boolean;
  legal: Action[];
  onAct: (action: Action) => void;
  humanTurn: boolean;
  hideVp: boolean;
}) {
  const goods = (Object.keys(player.goods) as Good[]).filter((g) => player.goods[g] > 0);
  return (
    <article className={`player-board ${self ? "self" : ""}`}>
      <header>
        <h2>{player.name}</h2>
        <p>
          {player.doubloons} 金
          {hideVp ? "" : ` · ${player.vpChips} 分`}
          {player.unplacedColonists > 0 ? ` · 未安置 ${player.unplacedColonists}` : ""}
          {player.sanJuan > 0 ? ` · 聖胡安 ${player.sanJuan}` : ""}
        </p>
      </header>
      <div className="island-grid">
        {player.island.map((tile, index) => {
          const action = legal.find(
            (a) => a.type === "mayorPlace" && a.target.kind === "island" && a.target.index === index,
          );
          return (
            <button
              key={index}
              className={`plot ${action ? "lit" : ""}`}
              style={{ background: GOOD_TONE[tile.type] }}
              disabled={!humanTurn || !action}
              onClick={() => action && onAct(action)}
            >
              {TILE_ZH[tile.type]}
              {tile.colonists > 0 ? " ●" : ""}
            </button>
          );
        })}
        {Array.from({ length: Math.max(0, 12 - player.island.length) }).map((_, i) => (
          <div key={`empty-${i}`} className="plot empty" />
        ))}
      </div>
      <div className="city-grid">
        {player.city.map((b) => {
          const def = getBuilding(b.buildingId);
          const action = legal.find(
            (a) => a.type === "mayorPlace" && a.target.kind === "building" && a.target.instanceId === b.instanceId,
          );
          return (
            <button
              key={b.instanceId}
              className={`bld ${def.kind} ${def.citySpaces > 1 ? "wide" : ""} ${action ? "lit" : ""}`}
              disabled={!humanTurn || !action}
              onClick={() => action && onAct(action)}
            >
              {def.nameZh}
              <span>
                {b.colonists}/{def.circles}
              </span>
            </button>
          );
        })}
      </div>
      {goods.length > 0 && (
        <div className="goods-row">
          {goods.map((g) => {
            const sell = legal.find((a) => a.type === "traderSell" && a.good === g);
            const extra = legal.find((a) => a.type === "craftsmanExtra" && a.good === g);
            const load = legal.filter((a) => a.type === "captainLoad" && a.good === g);
            const keep = legal.filter((a) => a.type === "captainStore" && (a.extra === g || a.keepTypes.includes(g)));
            return (
              <div key={g} className="good-chip" style={{ background: GOOD_TONE[g] }}>
                {GOOD_ZH[g]} ×{player.goods[g]}
                {sell && (
                  <button onClick={() => onAct(sell)} disabled={!humanTurn}>
                    賣
                  </button>
                )}
                {extra && (
                  <button onClick={() => onAct(extra)} disabled={!humanTurn}>
                    多拿
                  </button>
                )}
                {load.map((a, i) =>
                  a.type === "captainLoad" ? (
                    <button key={i} onClick={() => onAct(a)} disabled={!humanTurn}>
                      {a.destination === "wharf" ? "碼頭" : `船${a.destination + 1}`}
                    </button>
                  ) : null,
                )}
                {keep.length > 0 && humanTurn && <span className="hint">可保留</span>}
              </div>
            );
          })}
        </div>
      )}
    </article>
  );
}
