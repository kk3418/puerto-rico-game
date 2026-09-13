import { useEffect, useRef, useState } from "react";
import { abandonMatch, finishMatch, putMatchSave } from "../api/matches";
import { HeuristicAgent, HumanAgent, dispatchAction, type PlayerAgent } from "../agents";
import {
  chosenRoleFor,
  cloneViaJson,
  createInitialState,
  getActorIndex,
  getLegalActions,
  type Difficulty,
  type GameState,
  type PlayerCount,
  type ScoreBreakdown,
} from "../engine";
import { ActionPanel } from "./ActionPanel";
import { Board } from "./Board";
import { EndScreen } from "./EndScreen";
import { PlayerBoard } from "./PlayerBoard";
import { LeaveDialog } from "./LeaveDialog";
import { phasePrompt } from "./labels";
import { useMatchSync } from "./useMatchSync";
import "./GameScreen.css";

export function GameScreen({
  matchId,
  playerCount,
  difficulty,
  seed,
  nickname,
  initialState,
  nextSeq,
  onExit,
}: {
  matchId: string;
  playerCount: PlayerCount;
  difficulty: Difficulty;
  seed: number;
  nickname: string;
  initialState?: GameState;
  nextSeq: number;
  onExit: () => void;
}) {
  const humanRef = useRef(new HumanAgent());
  const startRef = useRef<GameState | null>(null);
  if (!startRef.current) {
    startRef.current = initialState
      ? cloneViaJson(initialState)
      : createInitialState({ playerCount, difficulty, seed, humanName: nickname });
  }
  const [state, setState] = useState<GameState>(startRef.current);
  const stateRef = useRef(state);
  stateRef.current = state;
  const [busy, setBusy] = useState(false);
  const [awaitingHuman, setAwaitingHuman] = useState(false);
  const [turnSeat, setTurnSeat] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [serverScores, setServerScores] = useState<ScoreBreakdown[] | null>(null);
  const [serverReason, setServerReason] = useState<string | null>(null);
  const [verified, setVerified] = useState(false);
  const [finishError, setFinishError] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);
  const { enqueue, flush, pending, syncError } = useMatchSync(matchId, nextSeq);

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
        setTurnSeat(idx);
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
        const before = current;
        current = await dispatchAction(current, action, player.id);
        enqueue(before, action, idx);
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
  }, [difficulty, enqueue, playerCount]);

  useEffect(() => {
    if (!state.gameOver || !state.scores) return;
    let cancelled = false;
    setFinishing(true);
    void (async () => {
      await flush();
      const result = await finishMatch(matchId);
      if (cancelled) return;
      setServerScores(result.scores);
      setServerReason(result.endReason);
      setVerified(result.verified);
    })()
      .catch((err: Error) => {
        if (!cancelled) setFinishError(err.message);
      })
      .finally(() => {
        if (!cancelled) setFinishing(false);
      });
    return () => {
      cancelled = true;
    };
  }, [flush, matchId, state.gameOver, state.scores]);

  function onAct(action: Parameters<typeof dispatchAction>[1]) {
    try {
      humanRef.current.submit(action);
    } catch (err) {
      setError(err instanceof Error ? err.message : "行動失敗");
    }
  }

  async function onSave() {
    setSaving(true);
    setError(null);
    try {
      await flush();
      const saved = await putMatchSave(matchId, stateRef.current);
      setSavedAt(saved.savedAt);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "存檔失敗");
      return false;
    } finally {
      setSaving(false);
    }
  }

  function onLeave() {
    setLeaveOpen(true);
  }

  async function onLeaveYes() {
    if (await onSave()) onExit();
  }

  async function onLeaveNo() {
    try {
      await flush();
      if (!stateRef.current.gameOver) {
        await abandonMatch(matchId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "離開失敗");
    }
    onExit();
  }

  if (state.gameOver && state.scores) {
    return (
      <EndScreen
        scores={serverScores ?? state.scores}
        reason={serverReason ?? state.endReason}
        verified={verified}
        finishing={finishing}
        finishError={finishError}
        onRetryFinish={() => {
          setFinishError(null);
          setFinishing(true);
          void (async () => {
            await flush();
            const result = await finishMatch(matchId);
            setServerScores(result.scores);
            setServerReason(result.endReason);
            setVerified(result.verified);
          })()
            .catch((err: Error) => setFinishError(err.message))
            .finally(() => setFinishing(false));
        }}
        onAgain={onExit}
      />
    );
  }

  const legal = getLegalActions(state);
  const humanTurn = awaitingHuman && !busy;
  const you = state.players[0]!;
  const others = state.players.slice(1);

  return (
    <div className="table">
      <header className="table-top">
        <p className="brand-mini">Puerto Rico</p>
        <p>
          第 {state.round} 輪 · 總督 {state.players[state.governorIndex]?.name}
          {state.endTriggered ? " · 終局已觸發" : ""}
          {pending > 0 ? " · 同步中" : ""}
          {savedAt ? " · 已存檔" : ""}
        </p>
        <div className="table-actions">
          <button type="button" className="text-btn" disabled={saving} onClick={() => void onSave()}>
            {saving ? "存檔中…" : "存檔"}
          </button>
          <button type="button" className="text-btn" onClick={onLeave}>
            離開
          </button>
        </div>
      </header>
      {leaveOpen && <LeaveDialog onYes={() => void onLeaveYes()} onNo={() => void onLeaveNo()} />}

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
              acting={turnSeat === index + 1}
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
            acting={humanTurn}
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
          <p className="save-note">存檔僅供單人續玩。之後多人對局需全體同意才能存檔。</p>
          {syncError && <p className="error">{syncError}</p>}
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
