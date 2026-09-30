import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import i18n from "../i18n";
import {
  clearLastMatchId,
  createGuest,
  getMe,
  readLastMatchId,
  readStoredNickname,
  writeLastMatchId,
  writeStoredNickname,
} from "../api/auth";
import { ApiError } from "../api/client";
import { formatApiError } from "../api/errorMessage";
import { createMatch, getMatch, getMatchState } from "../api/matches";
import { createRoom, joinRoom, listRooms, type RoomSummary } from "../api/rooms";
import type { AuthMe, MatchSummary } from "../api/types";
import type { Difficulty, GameState, PlayerCount } from "../engine";
import { GameScreen } from "./GameScreen";
import { LobbyScreen, type LobbyRoom } from "./LobbyScreen";
import { SetupScreen } from "./SetupScreen";

export type PlaySession = {
  mode: "solo" | "online";
  matchId: string;
  playerCount: PlayerCount;
  difficulty: Difficulty;
  seed: number;
  nickname: string;
  initialState?: GameState;
  nextSeq: number;
  playToken?: string;
  nonce: number;
};

export function App() {
  const [auth, setAuth] = useState<AuthMe | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [booting, setBooting] = useState(true);
  const [play, setPlay] = useState<PlaySession | null>(null);
  const [lobby, setLobby] = useState<LobbyRoom | null>(null);

  const refreshAuth = useCallback(async () => {
    let me = await getMe();
    if (!me.user && !me.guest) {
      me = await createGuest();
    }
    setAuth(me);
    return me;
  }, []);

  const enterMatch = useCallback((match: MatchSummary, state?: GameState) => {
    if (!match.playToken) {
      throw new Error(i18n.t("cannotStartMatch"));
    }
    if (match.seed == null && !state) {
      throw new Error(i18n.t("cannotStartMatch"));
    }
    writeLastMatchId(match.id);
    setPlay({
      mode: "solo",
      matchId: match.id,
      playerCount: match.playerCount,
      difficulty: match.difficulty,
      seed: match.seed ?? 0,
      nickname: match.humanName,
      initialState: state,
      nextSeq: match.eventCount + 1,
      playToken: match.playToken,
      nonce: Date.now(),
    });
  }, []);

  const enterOnline = useCallback((matchId: string, playerCount: PlayerCount, nickname: string) => {
    writeLastMatchId(matchId);
    setLobby(null);
    setPlay({
      mode: "online",
      matchId,
      playerCount,
      difficulty: "balanced",
      seed: 0,
      nickname,
      nextSeq: 1,
      nonce: Date.now(),
    });
  }, []);

  const resumeLiveMatch = useCallback(
    async (id: string) => {
      const live = await getMatchState(id);
      if (live.mode === "online") {
        enterOnline(live.id, live.playerCount, readStoredNickname());
        return live;
      }
      enterMatch(live, live.state);
      return live;
    },
    [enterMatch, enterOnline],
  );

  const resumeOnlineLobby = useCallback(async (id: string): Promise<boolean> => {
    try {
      const match = await getMatch(id);
      if (match.mode !== "online" || match.status !== "lobby") return false;
      const { rooms } = await listRooms().catch(() => ({ rooms: [] }));
      const item = rooms.find((r) => r.id === match.id);
      const hostSeatIndex = item?.hostNickname
        ? (match.participants.find((p) => p.nickname === item.hostNickname)?.seatIndex ?? null)
        : null;
      setLobby({
        id: match.id,
        joinCode: item?.joinCode ?? null,
        playerCount: match.playerCount,
        hostSeatIndex,
        seats: match.participants.map((p) => ({
          seatIndex: p.seatIndex,
          nickname: p.nickname,
          userId: p.userId,
          guestId: p.guestId,
        })),
      });
      return true;
    } catch {
      return false;
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("authError")) {
      setAuthError(i18n.t("oauthFailed"));
      window.history.replaceState({}, "", window.location.pathname);
    }
    void (async () => {
      await refreshAuth();
      const id = readLastMatchId();
      if (!id) return;
      try {
        await resumeLiveMatch(id);
      } catch (err) {
        if (err instanceof ApiError) {
          if (await resumeOnlineLobby(id)) return;
          clearLastMatchId();
        }
      }
    })()
      .catch((err: unknown) => {
        setBootError(formatApiError(err, i18n.t("serverUnreachable")));
      })
      .finally(() => {
        setBooting(false);
      });
  }, [refreshAuth, resumeLiveMatch, resumeOnlineLobby]);

  async function startNew(playerCount: PlayerCount, difficulty: Difficulty, nickname: string) {
    writeStoredNickname(nickname);
    await createGuest(nickname);
    const seed = Date.now() & 0x7fffffff;
    const match = await createMatch({ nickname, playerCount, difficulty, seed });
    enterMatch(match);
  }

  function lobbyFromRoom(room: RoomSummary): LobbyRoom {
    return {
      id: room.id,
      joinCode: room.joinCode,
      playerCount: room.playerCount,
      hostSeatIndex: room.hostSeatIndex,
      seats: room.seats,
    };
  }

  async function createOnlineRoom(playerCount: PlayerCount, nickname: string) {
    writeStoredNickname(nickname);
    await createGuest(nickname);
    const room = await createRoom({ nickname, playerCount });
    writeLastMatchId(room.id);
    setLobby(lobbyFromRoom(room));
  }

  async function joinOnlineRoom(nickname: string, target: { joinCode?: string; roomId?: string }) {
    writeStoredNickname(nickname);
    await createGuest(nickname);
    const room = await joinRoom({ nickname, ...target });
    writeLastMatchId(room.id);
    if (room.status === "playing") {
      enterOnline(room.id, room.playerCount, nickname);
      return;
    }
    setLobby(lobbyFromRoom(room));
  }

  async function continueMatch(match: MatchSummary) {
    if (match.mode === "online") {
      if (match.status === "playing") {
        enterOnline(match.id, match.playerCount, readStoredNickname());
        return;
      }
      throw new Error(i18n.t("matchNotFound"));
    }
    try {
      await resumeLiveMatch(match.id);
    } catch {
      throw new Error(i18n.t("matchNotFound"));
    }
  }

  async function continueLast() {
    const id = readLastMatchId();
    if (!id) {
      throw new Error(i18n.t("matchNotFound"));
    }
    try {
      await resumeLiveMatch(id);
    } catch {
      clearLastMatchId();
      throw new Error(i18n.t("matchNotFound"));
    }
  }

  const startOnlineFromLobby = useCallback(() => {
    if (!lobby) return;
    enterOnline(lobby.id, lobby.playerCount, readStoredNickname());
  }, [lobby, enterOnline]);

  const exitLobby = useCallback(() => {
    clearLastMatchId();
    setLobby(null);
  }, []);

  if (booting) {
    return <BootScreen />;
  }

  if (play) {
    return (
      <GameScreen
        key={play.nonce}
        matchId={play.matchId}
        playerCount={play.playerCount}
        difficulty={play.difficulty}
        seed={play.seed}
        nickname={play.nickname}
        initialState={play.initialState}
        nextSeq={play.nextSeq}
        playToken={play.playToken}
        online={play.mode === "online"}
        onExit={() => {
          void refreshAuth().catch(() => undefined);
          setPlay(null);
        }}
      />
    );
  }

  if (lobby) {
    return <LobbyScreen room={lobby} auth={auth} onStart={startOnlineFromLobby} onExit={exitLobby} />;
  }

  return (
    <SetupScreen
      auth={auth}
      authError={authError}
      bootError={bootError}
      onAuthChange={setAuth}
      onStart={(playerCount, difficulty, nickname) => startNew(playerCount, difficulty, nickname)}
      onContinue={continueMatch}
      onContinueLast={readLastMatchId() ? continueLast : undefined}
      onCreateRoom={createOnlineRoom}
      onJoinRoom={joinOnlineRoom}
    />
  );
}

function BootScreen() {
  const { t } = useTranslation();
  return (
    <div className="setup">
      <main className="setup-main">
        <p className="brand">{t("brand")}</p>
        <p>{t("loading")}</p>
      </main>
    </div>
  );
}
