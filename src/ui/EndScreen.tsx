import { useEffect, useState } from "react";
import { getMe } from "../api/auth";
import { getMyStats } from "../api/matches";
import type { UserStats } from "../api/types";
import type { ScoreBreakdown } from "../engine";
import "./EndScreen.css";

export function EndScreen({
  scores,
  reason,
  verified,
  finishing,
  finishError,
  onRetryFinish,
  onAgain,
}: {
  scores: ScoreBreakdown[];
  reason: string | null;
  verified: boolean;
  finishing: boolean;
  finishError: string | null;
  onRetryFinish: () => void;
  onAgain: () => void;
}) {
  const [stats, setStats] = useState<UserStats | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getMe()
      .then((me) => (me.authenticated ? getMyStats() : null))
      .then((next) => {
        if (!cancelled) setStats(next);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [verified]);

  return (
    <div className="end">
      <p className="brand">Puerto Rico</p>
      <h1>{scores[0]?.name}勝出</h1>
      <p className="end-reason">{reason}</p>
      {finishing && <p>伺服器正在重放對局並計分…</p>}
      {verified && <p className="verified">分數已由伺服器驗證</p>}
      {finishError && <p className="error">伺服器計分失敗：{finishError}。以下先顯示本機分數。</p>}
      <table>
        <thead>
          <tr>
            <th>玩家</th>
            <th>籌碼</th>
            <th>建築</th>
            <th>公會堂</th>
            <th>宅邸</th>
            <th>要塞</th>
            <th>海關</th>
            <th>市政廳</th>
            <th>總分</th>
          </tr>
        </thead>
        <tbody>
          {scores.map((s) => (
            <tr key={s.playerId}>
              <td>{s.name}</td>
              <td>{s.vpChips}</td>
              <td>{s.buildingVp}</td>
              <td>{s.guildHall}</td>
              <td>{s.residence}</td>
              <td>{s.fortress}</td>
              <td>{s.customsHouse}</td>
              <td>{s.cityHall}</td>
              <td>
                <strong>{s.total}</strong>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {stats && (
        <p className="end-stats">
          我的戰績：{stats.gamesPlayed} 場 · 勝 {stats.gamesWon} · 最佳 {stats.bestScore} 分
        </p>
      )}
      {finishError && (
        <button type="button" className="text-btn" disabled={finishing} onClick={onRetryFinish}>
          重試伺服器計分
        </button>
      )}
      <button type="button" className="start-btn" onClick={onAgain}>
        再來一局
      </button>
    </div>
  );
}
