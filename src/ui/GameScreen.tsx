import { useEffect, useRef, useState } from "react";
import { HeuristicAgent, HumanAgent, dispatchAction, type PlayerAgent } from "../agents";
import {
  chosenRoleFor,
  createInitialState,
  getActorIndex,
  getLegalActions,
  type Difficulty,
  type GameState,
  type PlayerCount,
} from "../engine";
import { ActionPanel } from "./ActionPanel";
import { Board } from "./Board";
import { EndScreen } from "./EndScreen";
import { PlayerBoard } from "./PlayerBoard";
import { phasePrompt } from "./labels";
import "./GameScreen.css";

export function GameScreen({
  playerCount,
  difficulty,
  onExit,
}: {
  playerCount: PlayerCount;
  difficulty: Difficulty;
  onExit: () => void;
}) {
  const humanRef = useRef(new HumanAgent());
  const startRef = useRef<GameState | null>(null);
  if (!startRef.current) {
    startRef.current = createInitialState({ playerCount, difficulty });
  }
  const [state, setState] = useState<GameState>(startRef.current);
  const [busy, setBusy] = useState(false);
  const [awaitingHuman, setAwaitingHuman] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const human = humanRef.current;
    let cancelled = false;
    let delayTimer: ReturnType<typeof setTimeout> | undefined;
    let delayResolve: (() => void) | undefined;
    const initial = startRef.current!;
    const agents: Record<string, PlayerAgent> = {};
    for (const p of initial.players) {
      agents[p.id] = p.isHuman ? human : new HeuristicAgent();
    }

    async function loop(start: GameState) {
      let current = start;
      while (!cancelled && !current.gameOver) {
        const idx = getActorIndex(current);
        if (idx === null) break;
        const player = current.players[idx]!;
        const legal = getLegalActions(current);
        if (legal.length === 0) break;
        const agent = agents[player.id];
        if (!agent) break;
        if (player.isHuman) {
          setBusy(false);
          setAwaitingHuman(true);
          setState(current);
        } else {
          setBusy(true);
          setAwaitingHuman(false);
        }
        const action = await agent.chooseAction({
          state: current,
          legalActions: legal,
          playerId: player.id,
        });
        setAwaitingHuman(false);
        if (cancelled) return;
        current = await dispatchAction(current, action, player.id);
        setState(current);
        const pause = agent.tablePauseAfterActionMs?.() ?? 0;
        if (pause > 0) {
          await delay(pause);
        }
        if (cancelled) return;
      }
      setBusy(false);
      setAwaitingHuman(false);
    }

    void loop(initial).catch((err: Error) => {
      if (!cancelled && err.message !== "cancelled") {
        setError(err.message);
        setBusy(false);
        setAwaitingHuman(false);
      }
    });

    function delay(ms: number): Promise<void> {
      return new Promise((resolve) => {
        delayResolve = resolve;
        delayTimer = setTimeout(() => {
          delayTimer = undefined;
          delayResolve = undefined;
          resolve();
        }, ms);
      });
    }

    return () => {
      cancelled = true;
      if (delayTimer !== undefined) clearTimeout(delayTimer);
      delayResolve?.();
      human.cancel();
    };
  }, [playerCount, difficulty]);

  function onAct(action: Parameters<typeof dispatchAction>[1]) {
    try {
      humanRef.current.submit(action);
    } catch (err) {
      setError(err instanceof Error ? err.message : "行動失敗");
    }
  }

  if (state.gameOver && state.scores) {
    return <EndScreen scores={state.scores} reason={state.endReason} onAgain={onExit} />;
  }

  const legal = getLegalActions(state);
  const humanTurn = awaitingHuman && !busy;
  const actor = getActorIndex(state);
  const you = state.players[0]!;
  const others = state.players.slice(1);

  return (
    <div className="table">
      <header className="table-top">
        <p className="brand-mini">Puerto Rico</p>
        <p>
          第 {state.round} 輪 · 總督 {state.players[state.governorIndex]?.name}
          {state.endTriggered ? " · 終局已觸發" : ""}
        </p>
        <button type="button" className="text-btn" onClick={onExit}>
          離開
        </button>
      </header>

      <main className={`table-arena seats-${state.players.length}`}>
        <div className="arena-board">
          <Board state={state} legal={humanTurn ? legal : []} onAct={onAct} humanTurn={humanTurn} />
        </div>
        <div className="arena-action">
          <ActionPanel
            legal={humanTurn ? legal : []}
            onAct={onAct}
            busy={busy}
            prompt={phasePrompt(state.phase.type)}
          />
        </div>
        {others.map((p, index) => (
          <div className={`player-seat seat-${index + 1}`} key={p.id}>
            <PlayerBoard
              player={p}
              self={false}
              acting={actor === index + 1}
              legal={[]}
              onAct={onAct}
              humanTurn={false}
              hideVp
              chosenRole={chosenRoleFor(state, index + 1)}
              isActiveRoleOwner={state.activeRoleOwnerIndex === index + 1}
              mayorReceived={receivedForPlayer(state, index + 1)}
            />
          </div>
        ))}
        <div className="player-seat self-seat">
          <PlayerBoard
            player={you}
            self
            acting={actor === 0}
            legal={humanTurn ? legal : []}
            onAct={onAct}
            humanTurn={humanTurn}
            hideVp={false}
            chosenRole={chosenRoleFor(state, 0)}
            isActiveRoleOwner={state.activeRoleOwnerIndex === 0}
            mayorReceived={receivedForPlayer(state, 0)}
          />
        </div>
        <aside className="arena-log">
          <h2>航海日誌</h2>
          <ol className="log">
            {state.log.slice(-8).map((e) => (
              <li key={e.id}>{e.text}</li>
            ))}
          </ol>
          {error && <p className="error">{error}</p>}
        </aside>
      </main>
    </div>
  );
}

function receivedForPlayer(state: GameState, playerIndex: number): number | undefined {
  return state.phase.type === "mayorAssign" && state.phase.actorIndex === playerIndex
    ? state.phase.received
    : undefined;
}
