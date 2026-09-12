import { useState } from "react";
import { readStoredNickname } from "../api/auth";
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
      setError(err instanceof Error ? err.message : "無法開始");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="setup">
      <div className="setup-sky" aria-hidden="true" />
      <div className="setup-island" aria-hidden="true" />
      <main className="setup-main">
        <p className="brand">Puerto Rico</p>
        <h1>在島嶼上種、造、運，成為最富裕的總督。</h1>
        <AuthBar auth={auth} onAuthChange={onAuthChange} />
        {authError && <p className="error">{authError}</p>}
        {bootError && <p className="error">{bootError}。請確認 API 與資料庫已啟動。</p>}
        <div className="setup-cta">
          <label className="nick-field">
            <span>暱稱</span>
            <input
              type="text"
              maxLength={24}
              value={nickname}
              placeholder="開局前必填"
              onChange={(e) => setNickname(e.target.value)}
            />
          </label>
          <fieldset>
            <legend>人數</legend>
            {([3, 4, 5] as const).map((n) => (
              <label key={n}>
                <input
                  type="radio"
                  name="count"
                  checked={playerCount === n}
                  onChange={() => setPlayerCount(n)}
                />
                {n} 人（你 + {n - 1} AI）
              </label>
            ))}
          </fieldset>
          <fieldset>
            <legend>AI</legend>
            <label>
              <input
                type="radio"
                name="diff"
                checked={difficulty === "balanced"}
                onChange={() => setDifficulty("balanced")}
              />
              均衡
            </label>
            <label>
              <input
                type="radio"
                name="diff"
                checked={difficulty === "aggressive"}
                onChange={() => setDifficulty("aggressive")}
              />
              積極
            </label>
          </fieldset>
          <button
            type="button"
            className="start-btn"
            disabled={!ready || !trimmed || busy}
            onClick={() => void run(() => onStart(playerCount, difficulty, trimmed))}
          >
            {busy ? "開局中…" : "開局"}
          </button>
          {onContinueLast && (
            <button
              type="button"
              className="text-btn"
              disabled={busy || !ready}
              onClick={() => void run(onContinueLast)}
            >
              讀取本機上一局存檔
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
