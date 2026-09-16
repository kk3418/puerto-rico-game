import { CITY_SPACES, citySpacesUsed, getBuilding, totalColonists, type Action, type PlayerState } from "../engine";
import { GOOD_TONE, GOOD_ZH, ROLE_ZH, TILE_ZH } from "./labels";
import type { Good, Role } from "../engine/types";
import { GameIcon } from "./icons";
import { Tooltip } from "./Tooltip";
import { BUILDING_TIP } from "./tooltips";

export function PlayerBoard({
  player,
  self,
  acting,
  legal,
  onAct,
  humanTurn,
  hideVp,
  chosenRole,
  isActiveRoleOwner,
  isGovernor,
  mayorReceived,
}: {
  player: PlayerState;
  self: boolean;
  acting?: boolean;
  legal: Action[];
  onAct: (action: Action) => void;
  humanTurn: boolean;
  hideVp: boolean;
  chosenRole?: Role | null;
  isActiveRoleOwner?: boolean;
  isGovernor?: boolean;
  mayorReceived?: number;
}) {
  const goods = (Object.keys(player.goods) as Good[]).filter((g) => player.goods[g] > 0);
  const colonists = totalColonists(player);
  const emptyCitySpaces = Math.max(0, CITY_SPACES - citySpacesUsed(player));
  return (
    <article className={`player-board ${self ? "self" : ""} ${acting ? "acting" : ""}`}>
      <header className="player-status">
        <h2>
          {isGovernor && (
            <Tooltip content="總督" className="governor-mark">
              <GameIcon kind="governor" size={28} label="總督" />
            </Tooltip>
          )}
          {player.name}
        </h2>
        <div className="status-resources">
          <span className="icon-label" title="金幣"><GameIcon kind="coin" />{player.doubloons}</span>
          {hideVp ? (
            <HiddenVpChips vp={player.vpChips} />
          ) : (
            <span className="icon-label" title="勝利分"><GameIcon kind="vp" />{player.vpChips}</span>
          )}
          <span className="icon-label" title={mayorReceived === undefined ? "殖民者總數" : "本輪新增／殖民者總數"}>
            <GameIcon kind="colonist" />{mayorReceived === undefined ? colonists : `${mayorReceived}/${colonists}`}
          </span>
          {player.unplacedColonists > 0 && <span className="status-note">待安置 {player.unplacedColonists}</span>}
          {player.sanJuan > 0 && <span className="status-note">聖胡安 {player.sanJuan}</span>}
        </div>
        <div
          className={`role-seat ${chosenRole ? "occupied" : ""} ${isActiveRoleOwner ? "active" : ""}`}
          aria-label={chosenRole ? `本輪角色：${ROLE_ZH[chosenRole]}` : "本輪角色"}
        >
          {chosenRole ? (
            <><GameIcon kind={chosenRole} size={22} /><span>{ROLE_ZH[chosenRole]}</span></>
          ) : (
            <span>角色位</span>
          )}
        </div>
      </header>

      <section className="player-zone city-zone">
        <h3>建築物區</h3>
        <div className="city-grid">
          {player.city.map((b) => {
            const def = getBuilding(b.buildingId);
            const place = legal.find(
              (a) => a.type === "mayorPlace" && a.target.kind === "building" && a.target.instanceId === b.instanceId,
            );
            const remove = findMayorRemove(legal, { kind: "building", instanceId: b.instanceId });
            return (
              <Tooltip
                key={b.instanceId}
                content={BUILDING_TIP[b.buildingId]}
                className={`city-slot ${def.citySpaces > 1 ? "wide" : ""}`}
              >
                <span className={`city-card ${remove ? "editable" : ""}`}>
                  <button
                    className={`bld ${def.kind} ${def.citySpaces > 1 ? "wide" : ""} ${place ? "lit" : ""}`}
                    disabled={!humanTurn || !place}
                    onClick={() => place && onAct(place)}
                  >
                    <span className="building-name">{def.nameZh}</span>
                    <span className="colonist-circles" aria-label={`${b.colonists}/${def.circles} 名殖民者`}>
                      {Array.from({ length: def.circles }).map((_, index) => (
                        <span key={index} className={index < b.colonists ? "filled" : ""}>
                          {index < b.colonists && <GameIcon kind="colonist" size={self ? 18 : 15} />}
                        </span>
                      ))}
                    </span>
                  </button>
                  {remove && (
                    <button
                      type="button"
                      className="remove-colonist"
                      onClick={() => onAct(remove)}
                      disabled={!humanTurn}
                      aria-label={`從${def.nameZh}取回一名殖民者`}
                    >
                      −<GameIcon kind="colonist" size={13} />
                    </button>
                  )}
                </span>
              </Tooltip>
            );
          })}
          {Array.from({ length: emptyCitySpaces }).map((_, index) => (
            <div key={`empty-city-${index}`} className="city-empty" aria-label="空的建築格" />
          ))}
        </div>
      </section>

      <section className="player-zone island-zone">
        <h3>種植園區</h3>
        <div className="island-grid">
        {player.island.map((tile, index) => {
          const place = legal.find(
            (a) => a.type === "mayorPlace" && a.target.kind === "island" && a.target.index === index,
          );
          const remove = findMayorRemove(legal, { kind: "island", index });
          const action = place ?? remove;
          return (
            <button
              key={index}
              className={`plot ${place ? "lit" : ""} ${remove ? "editable" : ""}`}
              style={{ background: GOOD_TONE[tile.type] }}
              disabled={!humanTurn || !action}
              onClick={() => action && onAct(action)}
              title={`${TILE_ZH[tile.type]}${remove ? "（點擊取回殖民者）" : ""}`}
            >
              <GameIcon kind={tile.type} size={self ? 24 : 18} />
              <span>{TILE_ZH[tile.type]}</span>
              {tile.colonists > 0 && <span className="colonist-dot" aria-label={`${tile.colonists} 名殖民者`}><GameIcon kind="colonist" size={15} /></span>}
            </button>
          );
        })}
        {Array.from({ length: Math.max(0, 12 - player.island.length) }).map((_, i) => (
          <div key={`empty-${i}`} className="plot empty" aria-label="空的島嶼格" />
        ))}
        </div>
      </section>

      {goods.length > 0 && (
        <section className="player-zone goods-zone">
          <h3>貨物</h3>
          <div className="goods-row">
            {goods.map((g) => {
              const sell = legal.find((a) => a.type === "traderSell" && a.good === g);
              const extra = legal.find((a) => a.type === "craftsmanExtra" && a.good === g);
              const load = legal.filter((a) => a.type === "captainLoad" && a.good === g);
              const keep = legal.filter((a) => a.type === "captainStore" && (a.extra === g || a.keepTypes.includes(g)));
              return (
                <div key={g} className="good-chip" style={{ background: GOOD_TONE[g] }}>
                  <span className="icon-label"><GameIcon kind={g} size={26} />{GOOD_ZH[g]} ×{player.goods[g]}</span>
                  {sell && (
                    <button onClick={() => onAct(sell)} disabled={!humanTurn}>賣</button>
                  )}
                  {extra && (
                    <button onClick={() => onAct(extra)} disabled={!humanTurn}>多拿</button>
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
        </section>
      )}
    </article>
  );
}

function HiddenVpChips({ vp }: { vp: number }) {
  if (vp <= 0) return null;
  return (
    <Tooltip content="勝利分籌碼（面朝下）" className="vp-chips">
      <span className="vp-chip-stack" aria-label="勝利分籌碼面朝下">
        <GameIcon kind="vpFive" size={20} />
        <GameIcon kind="vpOne" size={15} />
      </span>
    </Tooltip>
  );
}

type MayorTarget =
  | { kind: "island"; index: number }
  | { kind: "building"; instanceId: string };

function findMayorRemove(legal: Action[], target: MayorTarget): Action | undefined {
  return legal.find((action) => {
    if (action.type !== "mayorRemove" || action.target.kind !== target.kind) return false;
    return target.kind === "island"
      ? action.target.kind === "island" && action.target.index === target.index
      : action.target.kind === "building" && action.target.instanceId === target.instanceId;
  });
}
