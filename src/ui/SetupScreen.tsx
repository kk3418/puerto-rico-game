import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { readStoredNickname } from "../api/auth";
import { formatApiError } from "../api/errorMessage";
import { listRooms, type RoomListItem } from "../api/rooms";
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
  onCreateRoom,
  onJoinRoom,
}: {
  auth: AuthMe | null;
  authError: string | null;
  bootError: string | null;
  onAuthChange: (next: AuthMe) => void;
  onStart: (playerCount: PlayerCount, difficulty: Difficulty, nickname: string) => Promise<void>;
  onContinue: (match: MatchSummary) => Promise<void>;
  onContinueLast?: () => Promise<void>;
  onCreateRoom: (playerCount: PlayerCount, nickname: string) => Promise<void>;
  onJoinRoom: (nickname: string, target: { joinCode?: string; roomId?: string }) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [playerCount, setPlayerCount] = useState<PlayerCount>(4);
  const [difficulty, setDifficulty] = useState<Difficulty>("balanced");
  const [nickname, setNickname] = useState(readStoredNickname);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [onlineCount, setOnlineCount] = useState<PlayerCount>(2);
  const [joinCodeInput, setJoinCodeInput] = useState("");
  const [rooms, setRooms] = useState<RoomListItem[] | null>(null);

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

  const refreshRooms = useCallback(async () => {
    try {
      const result = await listRooms();
      setRooms(result.rooms);
      setError(null);
    } catch (err) {
      setError(formatApiError(err));
    }
  }, []);

  useEffect(() => {
    if (!ready) return;
    void refreshRooms();
  }, [ready, refreshRooms]);

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
        <section className="online-panel">
          <h2>{t("onlineTitle")}</h2>
          <div className="setup-cta">
            <fieldset>
              <legend>{t("playerCount")}</legend>
              {([2, 3, 4, 5] as const).map((n) => (
                <label key={n}>
                  <input
                    type="radio"
                    name="onlineCount"
                    checked={onlineCount === n}
                    onChange={() => setOnlineCount(n)}
                  />
                  {t("playerCountHumans", { count: n })}
                </label>
              ))}
            </fieldset>
            <button
              type="button"
              className="start-btn"
              disabled={!ready || !trimmed || busy}
              onClick={() => void run(() => onCreateRoom(onlineCount, trimmed))}
            >
              {busy ? t("creatingRoom") : t("createRoom")}
            </button>
            <label className="nick-field">
              <span>{t("joinCode")}</span>
              <input
                type="text"
                maxLength={6}
                value={joinCodeInput}
                placeholder={t("joinCodePlaceholder")}
                onChange={(e) => setJoinCodeInput(e.target.value.toUpperCase())}
              />
            </label>
            <button
              type="button"
              className="start-btn"
              disabled={!ready || !trimmed || !joinCodeInput.trim() || busy}
              onClick={() => void run(() => onJoinRoom(trimmed, { joinCode: joinCodeInput.trim() }))}
            >
              {busy ? t("joiningRoom") : t("joinRoom")}
            </button>
          </div>
          <div className="room-list">
            <div className="room-list-head">
              <h3>{t("openRooms")}</h3>
              <button
                type="button"
                className="text-btn"
                disabled={!ready || busy}
                onClick={() => void refreshRooms()}
              >
                {t("refreshRooms")}
              </button>
            </div>
            {rooms && rooms.length === 0 && <p>{t("noOpenRooms")}</p>}
            {rooms && rooms.length > 0 && (
              <ul className="match-list">
                {rooms.map((room) => (
                  <li key={room.id}>
                    {t("roomLine", {
                      host: room.hostNickname ?? "?",
                      taken: room.seatsTaken,
                      count: room.playerCount,
                    })}
                    {" · "}
                    <button
                      type="button"
                      className="text-btn"
                      disabled={!ready || !trimmed || busy}
                      onClick={() => void run(() => onJoinRoom(trimmed, { roomId: room.id }))}
                    >
                      {t("joinRoom")}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
        <StatsPanel
          authenticated={Boolean(auth?.authenticated)}
          onContinue={(match) => void run(() => onContinue(match))}
        />
      </main>
    </div>
  );
}
