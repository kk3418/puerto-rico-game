import { useCallback, useEffect, useState } from "react";
import {
  clearLastMatchId,
  createGuest,
  getMe,
  readLastMatchId,
  writeLastMatchId,
  writeStoredNickname,
} from "../api/auth";
import { ApiError } from "../api/client";
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
      throw new Error("無法開始對局");
    }
    if (match.seed == null && !state) {
      throw new Error("無法開始對局");
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
      setAuthError("第三方登入失敗");
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
      .catch((err: Error) => {
        setBootError(err.message || "無法連線伺服器");
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
      throw new Error("無法找到該局遊戲");
    }
  }

  async function continueLast() {
    const id = readLastMatchId();
    if (!id) {
      throw new Error("無法找到該局遊戲");
    }
    try {
      await resumeLiveMatch(id);
    } catch {
      clearLastMatchId();
      throw new Error("無法找到該局遊戲");
    }
  }

  if (booting) {
    return (
      <div className="setup">
        <main className="setup-main">
          <p className="brand">Puerto Rico</p>
          <p>載入中…</p>
        </main>
      </div>
    );
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
