import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import i18n from "../i18n";
import {
  clearLastMatchId,
  createGuest,
  getMe,
  readLastMatchId,
  writeLastMatchId,
  writeStoredNickname,
} from "../api/auth";
import { ApiError } from "../api/client";
import { formatApiError } from "../api/errorMessage";
import { createMatch, getMatchState } from "../api/matches";
import type { AuthMe, MatchSummary } from "../api/types";
import type { Difficulty, GameState, PlayerCount } from "../engine";
import { GameScreen } from "./GameScreen";
import { SetupScreen } from "./SetupScreen";

export type PlaySession = {
  matchId: string;
  playerCount: PlayerCount;
  difficulty: Difficulty;
  seed: number;
  nickname: string;
  initialState?: GameState;
  nextSeq: number;
  playToken: string;
  nonce: number;
};

export function App() {
  const [auth, setAuth] = useState<AuthMe | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [booting, setBooting] = useState(true);
  const [play, setPlay] = useState<PlaySession | null>(null);

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

  const resumeLiveMatch = useCallback(
    async (id: string) => {
      const live = await getMatchState(id);
      enterMatch(live, live.state);
      return live;
    },
    [enterMatch],
  );

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
  }, [refreshAuth, resumeLiveMatch]);

  async function startNew(playerCount: PlayerCount, difficulty: Difficulty, nickname: string) {
    writeStoredNickname(nickname);
    await createGuest(nickname);
    const seed = Date.now() & 0x7fffffff;
    const match = await createMatch({ nickname, playerCount, difficulty, seed });
    enterMatch(match);
  }

  async function continueMatch(match: MatchSummary) {
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

  if (booting) {
    return <BootScreen />;
  }

  if (!play) {
    return (
      <SetupScreen
        auth={auth}
        authError={authError}
        bootError={bootError}
        onAuthChange={setAuth}
        onStart={(playerCount, difficulty, nickname) => startNew(playerCount, difficulty, nickname)}
        onContinue={continueMatch}
        onContinueLast={readLastMatchId() ? continueLast : undefined}
      />
    );
  }

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
      onExit={() => {
        void refreshAuth().catch(() => undefined);
        setPlay(null);
      }}
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
