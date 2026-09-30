import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import i18n from "../i18n";
import { formatEndReason, formatLogEntry } from "../i18n/format";
import { abandonMatch, finishMatch, saveMatchConsent } from "../api/matches";
import { ApiError } from "../api/client";
import { formatApiError } from "../api/errorMessage";
import { clearLastMatchId } from "../api/auth";
import { getGameSocket } from "../api/socket";
import type { OnlineErrorPayload, OnlineOverPayload, OnlineStatePayload } from "../api/types";
import { HeuristicAgent, HumanAgent, dispatchAction, type PlayerAgent } from "../agents";
import {
  chosenRoleFor,
  cloneViaJson,
  createInitialState,
  getActorIndex,
  getLegalActions,
  type Action,
  type Difficulty,
  type GameState,
  type PlayerCount,
  type ScoreBreakdown,
} from "../engine";
import { ActionPanel } from "./ActionPanel";
import { Board } from "./Board";
import { EndScreen } from "./EndScreen";
import { PlayerBoard } from "./PlayerBoard";
import { Dialog } from "./Dialog";
import { LanguageSelect } from "./LanguageSelect";
import { phasePrompt } from "./labels";
import { useMatchSync } from "./useMatchSync";
import { PLAYER_BOARD_PANEL_ID, PlayerSeats, seatTabOrder } from "./PlayerSeats";
import "./GameScreen.css";

export function GameScreen({
  matchId,
  playerCount,
  difficulty,
  seed,
  nickname,
  initialState,
  nextSeq,
  playToken,
  online = false,
  onExit,
}: {
  matchId: string;
  playerCount: PlayerCount;
  difficulty: Difficulty;
  seed: number;
  nickname: string;
  initialState?: GameState;
  nextSeq: number;
  playToken?: string;
  online?: boolean;
  onExit: () => void;
}) {
  const { t } = useTranslation();
  const humanRef = useRef(new HumanAgent());
  const startRef = useRef<GameState | null>(null);
  if (!startRef.current && !online) {
    startRef.current = initialState
      ? cloneViaJson(initialState)
      : createInitialState({ playerCount, difficulty, seed, humanName: nickname });
  }
  const [state, setState] = useState<GameState | null>(startRef.current);
  const stateRef = useRef(state);
  stateRef.current = state;
  const [busy, setBusy] = useState(false);
  const [awaitingHuman, setAwaitingHuman] = useState(false);
  const [turnSeat, setTurnSeat] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<null | "leave">(null);
  const [logOpen, setLogOpen] = useState(false);
  const [selectedPlayerIndex, setSelectedPlayerIndex] = useState(() =>
    startRef.current ? Math.max(0, startRef.current.players.findIndex((p) => p.isHuman)) : 0,
  );
  const logRef = useRef<HTMLElement>(null);
  const logToggleRef = useRef<HTMLButtonElement>(null);
  const logListRef = useRef<HTMLOListElement>(null);
  const [serverScores, setServerScores] = useState<ScoreBreakdown[] | null>(null);
  const [serverReason, setServerReason] = useState<string | null>(null);
  const [verified, setVerified] = useState(false);
  const [finishError, setFinishError] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [seatIndex, setSeatIndex] = useState<number | null>(null);
  const [serverLegal, setServerLegal] = useState<Action[]>([]);
  const [connected, setConnected] = useState(true);
  const [onlineOver, setOnlineOver] = useState<"abandoned" | null>(null);
  const [consent, setConsent] = useState<{ consented: number; required: number } | null>(null);
  const { enqueue, flush, pending, syncError } = useMatchSync(matchId, nextSeq, playToken ?? "");

  const enqueueRef = useRef(enqueue);
  enqueueRef.current = enqueue;

  useEffect(() => {
    if (online) return;
    const human = humanRef.current;
    const initial = stateRef.current;
    if (!initial) return;
    let cancelled = false;
    let delayTimer: ReturnType<typeof setTimeout> | undefined;
    let delayResolve: (() => void) | undefined;
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
        if (legal.length === 0) {
          throw new Error(
            i18n.t("noLegalAction", { ns: "game", name: player.name, phase: current.phase.type }),
          );
        }
        const agent = agents[player.id];
        if (!agent) {
          throw new Error(i18n.t("missingAgent", { ns: "game", id: player.id }));
        }
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
        if (cancelled) return;
        enqueueRef.current(before, action, idx);
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

    void loop(initial).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : formatApiError(err);
      if (!cancelled && message !== "cancelled") {
        console.error(err);
        setError(formatApiError(err, message));
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
  }, [difficulty, online, playerCount]);

  useEffect(() => {
    if (!online) return;
    const socket = getGameSocket();

    function watch() {
      socket.emit("game:watch", { matchId });
    }
    function onConnect() {
      setConnected(true);
      watch();
    }
    function onState(payload: OnlineStatePayload) {
      if (payload.matchId !== matchId) return;
      setState(payload.state);
      setServerLegal(payload.legalActions);
      if (typeof payload.seatIndex === "number") {
        setSeatIndex((prev) => prev ?? payload.seatIndex!);
      }
    }
    function onOver(payload: OnlineOverPayload) {
      if (payload.matchId !== matchId) return;
      clearLastMatchId();
      if (payload.status === "finished" && payload.scores) {
        setServerScores(payload.scores);
        setServerReason(payload.endReason ?? null);
        setVerified(true);
      } else {
        setOnlineOver("abandoned");
      }
    }
    function onGameError(payload: OnlineErrorPayload) {
      setError(formatApiError(new ApiError(0, payload.error ?? "", payload.code, payload.params)));
    }
    function onDisconnect() {
      setConnected(false);
    }

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("connect_error", onDisconnect);
    socket.on("game:state", onState);
    socket.on("game:over", onOver);
    socket.on("game:error", onGameError);
    if (socket.connected) {
      watch();
    } else {
      setConnected(false);
    }
    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("connect_error", onDisconnect);
      socket.off("game:state", onState);
      socket.off("game:over", onOver);
      socket.off("game:error", onGameError);
    };
  }, [online, matchId]);

  useEffect(() => {
    if (online && seatIndex !== null) setSelectedPlayerIndex(seatIndex);
  }, [online, seatIndex]);

  const completeFinish = useCallback(async () => {
    await flush();
    const result = await finishMatch(matchId);
    if (result.verified) clearLastMatchId();
    return result;
  }, [flush, matchId]);

  useEffect(() => {
    if (online || !state?.gameOver || !state?.scores) return;
    let cancelled = false;
    setFinishing(true);
    void (async () => {
      const result = await completeFinish();
      if (cancelled) return;
      setServerScores(result.scores);
      setServerReason(result.endReason);
      setVerified(result.verified);
    })()
      .catch((err: unknown) => {
        if (!cancelled) setFinishError(formatApiError(err));
      })
      .finally(() => {
        if (!cancelled) setFinishing(false);
      });
    return () => {
      cancelled = true;
    };
  }, [completeFinish, online, state?.gameOver, state?.scores]);

  useEffect(() => {
    if (!logOpen) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setLogOpen(false);
    }
    function onPointer(event: PointerEvent) {
      const target = event.target as Node;
      if (logRef.current?.contains(target) || logToggleRef.current?.contains(target)) return;
      setLogOpen(false);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [logOpen]);

  useEffect(() => {
    if (error || syncError) setLogOpen(true);
  }, [error, syncError]);

  useEffect(() => {
    if (!logOpen) return;
    const list = logListRef.current;
    if (!list) return;
    list.scrollTop = list.scrollHeight;
  }, [logOpen, state?.log]);

  function onAct(action: Parameters<typeof dispatchAction>[1]) {
    if (online) {
      const current = stateRef.current;
      if (seatIndex === null || !current || getActorIndex(current) !== seatIndex) {
        setError(i18n.t("notYourTurn"));
        return;
      }
      getGameSocket().emit("game:action", { matchId, action });
      return;
    }
    try {
      humanRef.current.submit(action);
    } catch (err) {
      setError(formatApiError(err, i18n.t("actionFailed", { ns: "game" })));
    }
  }

  function onLeave() {
    setConsent(null);
    setDialog("leave");
  }

  async function onLeaveKeep() {
    try {
      await flush();
    } catch (err) {
      setError(formatApiError(err, i18n.t("leaveFailed", { ns: "game" })));
      return;
    }
    onExit();
  }

  async function onLeaveConsent() {
    try {
      const result = await saveMatchConsent(matchId);
      if (result.complete) {
        onExit();
        return;
      }
      setConsent({ consented: result.consented, required: result.required });
    } catch (err) {
      setError(formatApiError(err, i18n.t("leaveFailed", { ns: "game" })));
    }
  }

  async function onLeaveAbandon() {
    try {
      await flush().catch(() => undefined);
      if (!stateRef.current?.gameOver) {
        await abandonMatch(matchId);
      }
      clearLastMatchId();
    } catch (err) {
      setError(formatApiError(err, i18n.t("leaveFailed", { ns: "game" })));
      return;
    }
    onExit();
  }

  if (onlineOver === "abandoned") {
    return (
      <div className="table">
        <Dialog
          title={t("matchEnded", { ns: "game" })}
          actions={
            <button type="button" className="text-btn" onClick={onExit}>
              {t("leave", { ns: "game" })}
            </button>
          }
        >
          <p>{t("errors.MATCH_ABANDONED")}</p>
        </Dialog>
      </div>
    );
  }

  if (!state) {
    return (
      <div className="setup">
        <div className="setup-sky" aria-hidden="true" />
        <div className="setup-island" aria-hidden="true" />
        <main className="setup-main">
          <p className="brand">{t("brand")}</p>
          <p>{t("waitingForState", { ns: "game" })}</p>
          {error && <p className="error">{error}</p>}
          <button type="button" className="text-btn" onClick={onExit}>
            {t("leave", { ns: "game" })}
          </button>
        </main>
      </div>
    );
  }

  if (state.gameOver && state.scores) {
    return (
      <EndScreen
        scores={serverScores ?? state.scores}
        reason={formatEndReason(serverReason ?? state.endReason, t)}
        verified={verified}
        finishing={finishing}
        finishError={finishError}
        onRetryFinish={() => {
          setFinishError(null);
          setFinishing(true);
          void completeFinish()
            .then((result) => {
              setServerScores(result.scores);
              setServerReason(result.endReason);
              setVerified(result.verified);
            })
            .catch((err: unknown) => setFinishError(formatApiError(err)))
            .finally(() => setFinishing(false));
        }}
        onAgain={onExit}
      />
    );
  }

  const legal = online ? serverLegal : getLegalActions(state);
  const currentTurnSeat = online ? getActorIndex(state) : turnSeat;
  const humanTurn = online
    ? seatIndex !== null && currentTurnSeat === seatIndex && !state.gameOver
    : awaitingHuman && !busy;
  const youIndex = online
    ? (seatIndex ?? 0)
    : Math.max(0, state.players.findIndex((p) => p.isHuman));
  const selectedPlayer = state.players[selectedPlayerIndex] ?? state.players[youIndex]!;
  const selectedIsYou = selectedPlayerIndex === youIndex;

  return (
    <div className="table">
      <header className="table-top">
        <p className="brand-mini">{t("brand")}</p>
        <p>
          {t("roundHeader", { ns: "game", round: state.round, name: state.players[state.governorIndex]?.name })}
          {state.endTriggered ? t("endTriggered", { ns: "game" }) : ""}
          {online
            ? !connected
              ? ` · ${t("connectionLost", { ns: "game" })}`
              : !humanTurn && !state.gameOver
                ? ` · ${t("waitingForOpponent", { ns: "game" })}`
                : ""
            : syncError
              ? t("syncFailed", { ns: "game" })
              : pending > 0
                ? t("syncing", { ns: "game" })
                : ""}
        </p>
        <div className="table-actions">
          <LanguageSelect />
          <button
            ref={logToggleRef}
            type="button"
            className={`arena-log-toggle${logOpen ? " is-open" : ""}`}
            aria-expanded={logOpen}
            aria-controls="arena-log-panel"
            onClick={() => setLogOpen((open) => !open)}
          >
            {t("shipLog", { ns: "game" })}
          </button>
          <button type="button" className="text-btn" onClick={onLeave}>
            {t("leave", { ns: "game" })}
          </button>
        </div>
      </header>
      <aside
        ref={logRef}
        id="arena-log-panel"
        className="arena-log"
        aria-label={t("shipLog", { ns: "game" })}
        hidden={!logOpen}
      >
        {state.log.length === 0 ? (
          <p className="log">{t("noLog", { ns: "game" })}</p>
        ) : (
          <ol className="log" ref={logListRef}>
            {state.log.map((e) => (
              <li key={e.id}>{formatLogEntry(e, t)}</li>
            ))}
          </ol>
        )}
        {syncError && <p className="error">{syncError}</p>}
        {error && <p className="error">{error}</p>}
      </aside>
      {dialog === "leave" && (
        <Dialog
          title={t("leaveTitle", { ns: "game" })}
          showClose
          onClose={() => setDialog(null)}
          actions={
            <>
              <button type="button" className="text-btn" onClick={() => void onLeaveAbandon()}>
                {t("no", { ns: "game" })}
              </button>
              {online ? (
                consent ? (
                  <button type="button" className="text-btn" onClick={onExit}>
                    {t("leave", { ns: "game" })}
                  </button>
                ) : (
                  <button type="button" className="text-btn" onClick={() => void onLeaveConsent()}>
                    {t("yes", { ns: "game" })}
                  </button>
                )
              ) : (
                <button type="button" className="text-btn" onClick={() => void onLeaveKeep()}>
                  {t("yes", { ns: "game" })}
                </button>
              )}
            </>
          }
        >
          <p>
            {online
              ? consent
                ? t("saveConsentProgress", {
                    ns: "game",
                    consented: consent.consented,
                    required: consent.required,
                  })
                : t("leaveBodyOnline", { ns: "game" })
              : t("leaveBody", { ns: "game" })}
          </p>
        </Dialog>
      )}

      <main className="table-arena">
        <div className="arena-players">
          <PlayerSeats
            seats={seatTabOrder(youIndex, state.players.length).map((playerIndex) => ({
              player: state.players[playerIndex]!,
              playerIndex,
            }))}
            selectedIndex={selectedPlayerIndex}
            turnSeat={currentTurnSeat}
            governorIndex={state.governorIndex}
            youIndex={online ? (seatIndex ?? undefined) : undefined}
            onSelect={setSelectedPlayerIndex}
          />
          <div
            className="player-board-stage"
            role="tabpanel"
            id={PLAYER_BOARD_PANEL_ID}
            aria-labelledby={`player-seat-tab-${selectedPlayer.id}`}
          >
            <PlayerBoard
              key={selectedPlayer.id}
              player={selectedPlayer}
              self={selectedIsYou}
              acting={selectedIsYou ? humanTurn : currentTurnSeat === selectedPlayerIndex}
              legal={selectedIsYou && humanTurn ? legal : []}
              onAct={onAct}
              humanTurn={selectedIsYou && humanTurn}
              hideVp={!selectedIsYou}
              chosenRole={chosenRoleFor(state, selectedPlayerIndex)}
              isActiveRoleOwner={state.activeRoleOwnerIndex === selectedPlayerIndex}
              isGovernor={state.governorIndex === selectedPlayerIndex}
              mayorReceived={receivedForPlayer(state, selectedPlayerIndex)}
            />
          </div>
        </div>
        <div className="arena-board">
          <Board state={state} legal={humanTurn ? legal : []} onAct={onAct} humanTurn={humanTurn} />
        </div>
        <div className="arena-action">
          <ActionPanel
            legal={humanTurn ? legal : []}
            onAct={onAct}
            busy={online ? !humanTurn : busy}
            prompt={phasePrompt(state.phase.type)}
            phaseType={humanTurn ? state.phase.type : undefined}
            activeRole={state.phase.type === "chooseRole" ? null : state.activeRole}
            roleOwnerName={
              state.phase.type !== "chooseRole" && state.activeRoleOwnerIndex != null
                ? state.players[state.activeRoleOwnerIndex]?.name
                : null
            }
          />
        </div>
      </main>
    </div>
  );
}

function receivedForPlayer(state: GameState, playerIndex: number): number | undefined {
  return state.phase.type === "mayorAssign" && state.phase.actorIndex === playerIndex
    ? state.phase.received
    : undefined;
}
