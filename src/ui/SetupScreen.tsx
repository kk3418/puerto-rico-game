import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { readStoredNickname } from "../api/auth";
import { ApiError } from "../api/client";
import { formatApiError } from "../api/errorMessage";
import { leaveMatch } from "../api/matches";
import { cancelRoom, leaveRoom, listRooms, type RoomListItem } from "../api/rooms";
import type { AuthMe, MatchSummary } from "../api/types";
import type { Difficulty, PlayerCount } from "../engine/types";
import { AuthBar } from "./AuthBar";
import { Dialog } from "./Dialog";
import { StatsPanel } from "./StatsPanel";
import "./SetupScreen.css";

type SetupTab = "online" | "solo";

type BlockedMatch = {
  matchId: string;
  status: "lobby" | "playing";
  isHost: boolean;
  retry: () => Promise<void>;
};

export function SetupScreen({
  auth,
  authError,
  bootError,
  notice,
  onClearNotice,
  onAuthChange,
  onStart,
  onContinue,
  onContinueLast,
  onCreateRoom,
  onJoinRoom,
  onOpenMatch,
}: {
  auth: AuthMe | null;
  authError: string | null;
  bootError: string | null;
  notice: string | null;
  onClearNotice: () => void;
  onAuthChange: (next: AuthMe) => void;
  onStart: (playerCount: PlayerCount, difficulty: Difficulty, nickname: string) => Promise<void>;
  onContinue: (match: MatchSummary) => Promise<void>;
  onContinueLast?: () => Promise<void>;
  onCreateRoom: (playerCount: PlayerCount, nickname: string) => Promise<void>;
  onJoinRoom: (nickname: string, target: { joinCode?: string; roomId?: string }) => Promise<void>;
  onOpenMatch: (matchId: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<SetupTab>("online");
  const [playerCount, setPlayerCount] = useState<PlayerCount>(4);
  const [difficulty, setDifficulty] = useState<Difficulty>("balanced");
  const [nickname, setNickname] = useState(readStoredNickname);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<BlockedMatch | null>(null);
  const [onlineCount, setOnlineCount] = useState<PlayerCount>(2);
  const [joinCodeInput, setJoinCodeInput] = useState("");
  const [rooms, setRooms] = useState<RoomListItem[] | null>(null);

  const ready = Boolean(auth?.user || auth?.guest) && !bootError;
  const onlineReady = Boolean(auth?.user) && !bootError;
  const trimmed = nickname.trim();

  async function run(task: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await task();
    } catch (err) {
      if (err instanceof ApiError && err.code === "ROOM_ALREADY_IN_MATCH" && err.params?.matchId) {
        setBlocked({
          matchId: String(err.params.matchId),
          status: err.params.status === "playing" ? "playing" : "lobby",
          isHost: err.params.isHost === 1 || err.params.isHost === "1",
          retry: task,
        });
        return;
      }
      setError(formatApiError(err, t("cannotStart")));
    } finally {
      setBusy(false);
    }
  }

  async function releaseBlocked(current: BlockedMatch): Promise<void> {
    if (current.status === "playing") {
      await leaveMatch(current.matchId);
      return;
    }
    if (current.isHost) {
      try {
        await cancelRoom(current.matchId);
        return;
      } catch (err) {
        if (err instanceof ApiError && err.code === "ROOM_NOT_LOBBY") {
          await leaveMatch(current.matchId);
          return;
        }
        if (!(err instanceof ApiError && err.code === "ROOM_NOT_HOST")) throw err;
      }
    }
    try {
      await leaveRoom(current.matchId);
    } catch (err) {
      if (err instanceof ApiError && err.code === "ROOM_NOT_LOBBY") {
        await leaveMatch(current.matchId);
        return;
      }
      throw err;
    }
  }

  async function openBlockedMatch() {
    const current = blocked;
    if (!current) return;
    setBusy(true);
    setError(null);
    try {
      await onOpenMatch(current.matchId);
      setBlocked(null);
    } catch (err) {
      setError(formatApiError(err, t("matchNotFound")));
    } finally {
      setBusy(false);
    }
  }

  async function continueAfterBlockedMatch() {
    const current = blocked;
    if (!current) return;
    setBusy(true);
    setError(null);
    try {
      await releaseBlocked(current);
    } catch (err) {
      const gone =
        err instanceof ApiError &&
        (err.status === 404 ||
          err.code === "ROOM_NOT_FOUND" ||
          err.code === "MATCH_NOT_FOUND" ||
          err.code === "ROOM_NOT_JOINED" ||
          err.code === "MATCH_ALREADY_ENDED" ||
          err.code === "MATCH_ABANDONED" ||
          err.code === "MATCH_NOT_PLAYING");
      if (!gone) {
        setError(formatApiError(err, t("cannotStart")));
        setBusy(false);
        return;
      }
    }
    setBlocked(null);
    setBusy(false);
    await run(current.retry);
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
    if (!onlineReady || tab !== "online") return;
    void refreshRooms();
  }, [onlineReady, tab, refreshRooms]);

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

        <label className="nick-field setup-nick">
          <span>{t("nickname")}</span>
          <input
            type="text"
            maxLength={24}
            value={nickname}
            placeholder={t("nicknamePlaceholder")}
            onChange={(e) => setNickname(e.target.value)}
          />
        </label>

        <div className="setup-tabs" role="tablist" aria-label={t("setupModes")}>
          <button
            type="button"
            role="tab"
            id="setup-tab-online"
            aria-selected={tab === "online"}
            aria-controls="setup-panel-online"
            className={tab === "online" ? "is-active" : undefined}
            onClick={() => {
              setTab("online");
              setError(null);
            }}
          >
            {t("onlineTitle")}
          </button>
          <button
            type="button"
            role="tab"
            id="setup-tab-solo"
            aria-selected={tab === "solo"}
            aria-controls="setup-panel-solo"
            className={tab === "solo" ? "is-active" : undefined}
            onClick={() => {
              setTab("solo");
              setError(null);
            }}
          >
            {t("soloTitle")}
          </button>
        </div>

        {error && <p className="error">{error}</p>}

        {notice && (
          <Dialog
            title={t("resumeNoticeTitle")}
            actions={
              <button type="button" className="text-btn" onClick={onClearNotice}>
                {t("close")}
              </button>
            }
          >
            <p>{notice}</p>
          </Dialog>
        )}

        {blocked && (
          <Dialog
            title={t("activeMatchTitle")}
            showClose
            onClose={() => setBlocked(null)}
            actions={
              <>
                <button type="button" className="text-btn" disabled={busy} onClick={() => void openBlockedMatch()}>
                  {t("returnToMatch")}
                </button>
                <button
                  type="button"
                  className="text-btn"
                  disabled={busy}
                  onClick={() => void continueAfterBlockedMatch()}
                >
                  {t(blocked.status === "playing" ? "leaveMatchAndContinue" : "leaveOldRoomAndContinue")}
                </button>
              </>
            }
          >
            <p>{t(blocked.status === "playing" ? "activeMatchPlaying" : "activeMatchLobby")}</p>
            {blocked.status === "playing" && <p>{t("activeMatchAiWarning")}</p>}
          </Dialog>
        )}

        {tab === "online" ? (
          <section
            className="setup-panel"
            role="tabpanel"
            id="setup-panel-online"
            aria-labelledby="setup-tab-online"
          >
            {!auth?.user && <p className="hint">{t("signInToPlayOnline")}</p>}
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
              <div className="setup-actions-row">
                <button
                  type="button"
                  className="start-btn"
                  disabled={!onlineReady || !trimmed || busy}
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
                  disabled={!onlineReady || !trimmed || !joinCodeInput.trim() || busy}
                  onClick={() => void run(() => onJoinRoom(trimmed, { joinCode: joinCodeInput.trim() }))}
                >
                  {busy ? t("joiningRoom") : t("joinRoom")}
                </button>
              </div>
            </div>
            <div className="room-list">
              <div className="room-list-head">
                <h3>{t("openRooms")}</h3>
                <button
                  type="button"
                  className="text-btn"
                  disabled={!onlineReady || busy}
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
                        disabled={!onlineReady || !trimmed || busy}
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
        ) : (
          <section
            className="setup-panel"
            role="tabpanel"
            id="setup-panel-solo"
            aria-labelledby="setup-tab-solo"
          >
            <div className="setup-cta">
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
          </section>
        )}

        <StatsPanel
          authenticated={Boolean(auth?.authenticated)}
          onContinue={(match) => void run(() => onContinue(match))}
        />
      </main>
    </div>
  );
}
