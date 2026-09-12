import { useEffect, useState } from "react";
import { getMyMatches, getMyStats } from "../api/matches";
import type { MatchSummary, UserStats } from "../api/types";

export function StatsPanel({
  authenticated,
  onContinue,
}: {
  authenticated: boolean;
  onContinue: (match: MatchSummary) => void;
}) {
  const [stats, setStats] = useState<UserStats | null>(null);
  const [matches, setMatches] = useState<MatchSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authenticated) return;
    let cancelled = false;
    void Promise.all([getMyStats(), getMyMatches()])
      .then(([nextStats, nextMatches]) => {
        if (cancelled) return;
        setStats(nextStats);
        setMatches(nextMatches.matches);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [authenticated]);

  if (!authenticated) return null;

  const resumable = matches.find((m) => m.status === "playing" && m.hasSave);

  return (
    <section className="stats-panel">
      <h2>我的戰績</h2>
      {error && <p className="error">{error}</p>}
      {stats && (
        <p>
          {stats.gamesPlayed} 場已驗證 · 勝 {stats.gamesWon} · 最佳 {stats.bestScore} 分
        </p>
      )}
      {resumable && (
        <button type="button" className="text-btn" onClick={() => onContinue(resumable)}>
          繼續未完對局
        </button>
      )}
      {matches.length > 0 && (
        <ol className="match-list">
          {matches.slice(0, 6).map((match) => (
            <li key={match.id}>
              {match.humanName} · {match.playerCount} 人 · {statusLabel(match.status)}
              {match.verified ? " · 已驗證" : ""}
              {match.participants[0]?.scores ? ` · ${match.participants[0].scores.total} 分` : ""}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function statusLabel(status: MatchSummary["status"]): string {
  if (status === "playing") return "進行中";
  if (status === "finished") return "已結束";
  return "已放棄";
}
