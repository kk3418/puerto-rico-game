import { useCallback, useEffect, useState } from "react";
import {
  clearLastMatchId,
  createGuest,
  getMe,
  readLastMatchId,
  writeLastMatchId,
  writeStoredNickname,
} from "../api/auth";
import { createMatch, getMatch, getMatchSave } from "../api/matches";
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
  nonce: number;
};

export function App() {
  const [auth, setAuth] = useState<AuthMe | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [play, setPlay] = useState<PlaySession | null>(null);

  const refreshAuth = useCallback(async () => {
    let me = await getMe();
    if (!me.user && !me.guest) {
      me = await createGuest();
    }
    setAuth(me);
    return me;
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("authError")) {
      setAuthError("第三方登入失敗");
      window.history.replaceState({}, "", window.location.pathname);
    }
    void refreshAuth().catch((err: Error) => {
      setBootError(err.message || "無法連線伺服器");
    });
  }, [refreshAuth]);

  async function startNew(playerCount: PlayerCount, difficulty: Difficulty, nickname: string) {
    writeStoredNickname(nickname);
    await createGuest(nickname);
    const seed = Date.now() & 0x7fffffff;
    const match = await createMatch({ nickname, playerCount, difficulty, seed });
    writeLastMatchId(match.id);
    setPlay({
      matchId: match.id,
      playerCount: match.playerCount,
      difficulty: match.difficulty,
      seed: match.seed,
      nickname: match.humanName,
      nextSeq: 1,
      nonce: Date.now(),
    });
  }

  async function continueMatch(match: MatchSummary) {
    const save = await getMatchSave(match.id);
    writeLastMatchId(match.id);
    setPlay({
      matchId: match.id,
      playerCount: match.playerCount,
      difficulty: match.difficulty,
      seed: match.seed,
      nickname: match.humanName,
      initialState: save.state,
      nextSeq: match.eventCount + 1,
      nonce: Date.now(),
    });
  }

  async function continueLast() {
    const id = readLastMatchId();
    if (!id) return;
    const match = await getMatch(id);
    if (match.status !== "playing" || !match.hasSave) {
      clearLastMatchId();
      throw new Error("沒有可繼續的存檔");
    }
    await continueMatch(match);
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
      onExit={() => {
        void refreshAuth().catch(() => undefined);
        setPlay(null);
      }}
    />
  );
}
