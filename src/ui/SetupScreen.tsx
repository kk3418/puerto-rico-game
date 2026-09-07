import { useState } from "react";
import type { Difficulty, PlayerCount } from "../engine/types";
import "./SetupScreen.css";

export function SetupScreen({
  onStart,
}: {
  onStart: (playerCount: PlayerCount, difficulty: Difficulty) => void;
}) {
  const [playerCount, setPlayerCount] = useState<PlayerCount>(4);
  const [difficulty, setDifficulty] = useState<Difficulty>("balanced");

  return (
    <div className="setup">
      <div className="setup-sky" aria-hidden="true" />
      <div className="setup-island" aria-hidden="true" />
      <main className="setup-main">
        <p className="brand">Puerto Rico</p>
        <h1>在島嶼上種、造、運，成為最富裕的總督。</h1>
        <div className="setup-cta">
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
          <button type="button" className="start-btn" onClick={() => onStart(playerCount, difficulty)}>
            開局
          </button>
        </div>
      </main>
    </div>
  );
}
