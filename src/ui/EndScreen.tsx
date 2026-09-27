import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getMe } from "../api/auth";
import { getMyStats } from "../api/matches";
import type { UserStats } from "../api/types";
import type { ScoreBreakdown } from "../engine";
import { LanguageSelect } from "./LanguageSelect";
import { buildingName } from "./labels";
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
  const { t } = useTranslation();
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
      <div className="end-toolbar">
        <LanguageSelect compact />
      </div>
      <p className="brand">{t("brand")}</p>
      <h1>{t("winner", { ns: "game", name: scores[0]?.name })}</h1>
      <p className="end-reason">{reason}</p>
      {finishing && <p>{t("finishing", { ns: "game" })}</p>}
      {verified && <p className="verified">{t("verified", { ns: "game" })}</p>}
      {finishError && (
        <p className="error">{t("finishFailed", { ns: "game", message: finishError })}</p>
      )}
      <table>
        <thead>
          <tr>
            <th>{t("player", { ns: "game" })}</th>
            <th>{t("chips", { ns: "game" })}</th>
            <th>{t("buildings", { ns: "game" })}</th>
            <th>{buildingName("guildHall")}</th>
            <th>{buildingName("residence")}</th>
            <th>{buildingName("fortress")}</th>
            <th>{buildingName("customsHouse")}</th>
            <th>{buildingName("cityHall")}</th>
            <th>{t("total", { ns: "game" })}</th>
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
          {t("endStats", {
            ns: "game",
            played: stats.gamesPlayed,
            won: stats.gamesWon,
            best: stats.bestScore,
          })}
        </p>
      )}
      {finishError && (
        <button type="button" className="text-btn" disabled={finishing} onClick={onRetryFinish}>
          {t("retryFinish", { ns: "game" })}
        </button>
      )}
      <button type="button" className="start-btn" onClick={onAgain}>
        {t("playAgain", { ns: "game" })}
      </button>
    </div>
  );
}
