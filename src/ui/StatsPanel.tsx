import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatApiError } from "../api/errorMessage";
import { getMyMatches, getMyStats } from "../api/matches";
import type { MatchSummary, UserStats } from "../api/types";

export function StatsPanel({
  authenticated,
  onContinue,
}: {
  authenticated: boolean;
  onContinue: (match: MatchSummary) => void;
}) {
  const { t } = useTranslation();
  const [stats, setStats] = useState<UserStats | null>(null);
  const [matches, setMatches] = useState<MatchSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authenticated) return;
    let cancelled = false;
    void Promise.all([getMyStats(), getMyMatches()])
      .then(([nextStats, nextMatches]) => {
        if (!cancelled) {
          setStats(nextStats);
          setMatches(nextMatches.matches);
        }
      })
      .catch((err: Error) => {
        if (!cancelled) setError(formatApiError(err));
      });
    return () => {
      cancelled = true;
    };
  }, [authenticated]);

  if (!authenticated) return null;

  const resumable = matches.find((m) => m.status === "playing");

  return (
    <section className="stats-panel">
      <h2>{t("myRecord")}</h2>
      {error && <p className="error">{error}</p>}
      {stats && (
        <p>
          {t("statsLine", {
            played: stats.gamesPlayed,
            won: stats.gamesWon,
            best: stats.bestScore,
          })}
        </p>
      )}
      {resumable && (
        <button type="button" className="text-btn" onClick={() => onContinue(resumable)}>
          {t("continueOpen")}
        </button>
      )}
      {matches.length > 0 && (
        <ol className="match-list">
          {matches.slice(0, 6).map((match) => (
            <li key={match.id}>
              {t("matchLine", {
                name: match.humanName,
                count: match.playerCount,
                status: statusLabel(match.status, t),
              })}
              {match.verified ? t("verifiedSuffix") : ""}
              {match.participants[0]?.scores
                ? t("scoreSuffix", { score: match.participants[0].scores.total })
                : ""}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function statusLabel(
  status: MatchSummary["status"],
  t: (key: string) => string,
): string {
  if (status === "lobby") return t("statusLobby");
  if (status === "playing") return t("statusPlaying");
  if (status === "finished") return t("statusFinished");
  return t("statusAbandoned");
}
