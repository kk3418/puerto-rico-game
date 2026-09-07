import { useState } from "react";
import type { Difficulty, PlayerCount } from "../engine/types";
import { GameScreen } from "./GameScreen";
import { SetupScreen } from "./SetupScreen";

export function App() {
  const [session, setSession] = useState<{
    playerCount: PlayerCount;
    difficulty: Difficulty;
    nonce: number;
  } | null>(null);

  if (!session) {
    return (
      <SetupScreen
        onStart={(playerCount, difficulty) => setSession({ playerCount, difficulty, nonce: Date.now() })}
      />
    );
  }

  return (
    <GameScreen
      key={session.nonce}
      playerCount={session.playerCount}
      difficulty={session.difficulty}
      onExit={() => setSession(null)}
    />
  );
}
