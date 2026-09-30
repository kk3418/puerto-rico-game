import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError } from "../api/client";
import { formatApiError } from "../api/errorMessage";
import { getMatch } from "../api/matches";
import { cancelRoom, leaveRoom } from "../api/rooms";
import type { AuthMe } from "../api/types";
import type { PlayerCount } from "../engine";
import "./LobbyScreen.css";

export type LobbySeat = {
  seatIndex: number;
  nickname: string;
  userId: string | null;
  guestId: string | null;
};

export type LobbyRoom = {
  id: string;
  joinCode: string | null;
  playerCount: PlayerCount;
  hostSeatIndex: number | null;
  seats: LobbySeat[];
};

const POLL_MS = 2000;

export function LobbyScreen({
  room,
  auth,
  onStart,
  onExit,
}: {
  room: LobbyRoom;
  auth: AuthMe | null;
  onStart: () => void;
  onExit: () => void;
}) {
  const { t } = useTranslation();
  const [seats, setSeats] = useState<LobbySeat[]>(room.seats);
  const [closed, setClosed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mySeat = seats.find(
    (p) => (auth?.user && p.userId === auth.user.id) || (auth?.guest && p.guestId === auth.guest.id),
  );
  const isHost = mySeat != null && room.hostSeatIndex === mySeat.seatIndex;

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const match = await getMatch(room.id);
        if (cancelled) return;
        if (match.status === "playing") {
          onStart();
          return;
        }
        if (match.status !== "lobby") {
          setClosed(true);
          return;
        }
        setSeats(
          match.participants.map((p) => ({
            seatIndex: p.seatIndex,
            nickname: p.nickname,
            userId: p.userId,
            guestId: p.guestId,
          })),
        );
        setError(null);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) {
          setClosed(true);
        } else {
          setError(formatApiError(err));
        }
      }
    }
    void poll();
    const timer = setInterval(() => void poll(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [room.id, onStart]);

  const leave = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      if (isHost) {
        await cancelRoom(room.id);
      } else {
        await leaveRoom(room.id);
      }
      onExit();
    } catch (err) {
      setError(formatApiError(err));
      setBusy(false);
    }
  }, [isHost, room.id, onExit]);

  return (
    <div className="setup">
      <div className="setup-sky" aria-hidden="true" />
      <div className="setup-island" aria-hidden="true" />
      <main className="setup-main">
        <p className="brand">{t("brand")}</p>
        <h1>{t("lobbyTitle")}</h1>
        {closed ? (
          <>
            <p className="error">{t("roomClosed")}</p>
            <div className="lobby-actions">
              <button type="button" className="text-btn" onClick={onExit}>
                {t("back")}
              </button>
            </div>
          </>
        ) : (
          <>
            {room.joinCode && (
              <p className="lobby-code">
                {t("joinCode")}
                <strong>{room.joinCode}</strong>
              </p>
            )}
            <p className="lobby-waiting">{t("lobbyWaiting", { taken: seats.length, count: room.playerCount })}</p>
            <ul className="lobby-seats">
              {Array.from({ length: room.playerCount }, (_, i) => {
                const seat = seats.find((s) => s.seatIndex === i);
                return (
                  <li key={i} className={seat ? undefined : "empty"}>
                    <span>
                      {seat ? seat.nickname : t("openSeat")}
                      {seat && mySeat && seat.seatIndex === mySeat.seatIndex
                        ? t("youSuffix", { ns: "game" })
                        : ""}
                    </span>
                    {seat && room.hostSeatIndex === i && <span className="lobby-host">{t("hostBadge")}</span>}
                  </li>
                );
              })}
            </ul>
            {error && <p className="error">{error}</p>}
            <div className="lobby-actions">
              <button type="button" className="text-btn" disabled={busy} onClick={() => void leave()}>
                {isHost ? t("cancelRoom") : t("leaveRoom")}
              </button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
