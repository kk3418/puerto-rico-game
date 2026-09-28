import { useState } from "react";
import { useTranslation } from "react-i18next";
import { readStoredNickname } from "../api/auth";
import { formatApiError } from "../api/errorMessage";
import type { AuthMe, MatchSummary } from "../api/types";
import type { Difficulty, PlayerCount } from "../engine/types";
import { AuthBar } from "./AuthBar";
import { StatsPanel } from "./StatsPanel";
import "./SetupScreen.css";

export function SetupScreen({
  auth,
  authError,
  bootError,
  onAuthChange,
  onStart,
  onContinue,
  onContinueLast,
}: {
  auth: AuthMe | null;
  authError: string | null;
  bootError: string | null;
  onAuthChange: (next: AuthMe) => void;
  onStart: (playerCount: PlayerCount, difficulty: Difficulty, nickname: string) => Promise<void>;
  onContinue: (match: MatchSummary) => Promise<void>;
  onContinueLast?: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [playerCount, setPlayerCount] = useState<PlayerCount>(4);
  const [difficulty, setDifficulty] = useState<Difficulty>("balanced");
  const [nickname, setNickname] = useState(readStoredNickname);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready = Boolean(auth?.user || auth?.guest) && !bootError;
  const trimmed = nickname.trim();

  async function run(task: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await task();
    } catch (err) {
      setError(formatApiError(err, t("cannotStart")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="setup">
      <div className="setup-sky" aria-hidden="true" />
      <div className="setup-island" aria-hidden="true" />
      <main className="setup-main">
        <p className="brand">{t("brand")}</p>
        <h1>{t("tagline")}</h1>
        <AuthBar auth={auth} onAuthChange={onAuthChange} />
        {authError && <p className="error">{authError}</p>}
        {bootError && <p className="error">{t("bootHint", { message: bootError })}</p>}
        <div className="setup-cta">
          <label className="nick-field">
            <span>{t("nickname")}</span>
            <input
              type="text"
              maxLength={24}
              value={nickname}
              placeholder={t("nicknamePlaceholder")}
              onChange={(e) => setNickname(e.target.value)}
            />
          </label>
          <fieldset>
            <legend>{t("playerCount")}</legend>
            {([3, 4, 5] as const).map((n) => (
              <label key={n}>
                <input
                  type="radio"
                  name="count"
                  checked={playerCount === n}
                  onChange={() => setPlayerCount(n)}
                />
                {t("playerCountOption", { count: n, ai: n - 1 })}
              </label>
            ))}
          </fieldset>
          <fieldset>
            <legend>{t("ai")}</legend>
            <label>
              <input
                type="radio"
                name="diff"
                checked={difficulty === "balanced"}
                onChange={() => setDifficulty("balanced")}
              />
              {t("aiBalanced")}
            </label>
            <label>
              <input
                type="radio"
                name="diff"
                checked={difficulty === "aggressive"}
                onChange={() => setDifficulty("aggressive")}
              />
              {t("aiAggressive")}
            </label>
          </fieldset>
          <button
            type="button"
            className="start-btn"
            disabled={!ready || !trimmed || busy}
            onClick={() => void run(() => onStart(playerCount, difficulty, trimmed))}
          >
            {busy ? t("starting") : t("start")}
          </button>
          {onContinueLast && (
            <button
              type="button"
              className="text-btn"
              disabled={busy || !ready}
              onClick={() => void run(onContinueLast)}
            >
              {t("continueLast")}
            </button>
          )}
        </div>
        {error && <p className="error">{error}</p>}
        <StatsPanel
          authenticated={Boolean(auth?.authenticated)}
          onContinue={(match) => void run(() => onContinue(match))}
        />
      </main>
    </div>
  );
}
