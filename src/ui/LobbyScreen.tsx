import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError } from "../api/client";
import { formatApiError } from "../api/errorMessage";
import { cancelRoom, heartbeatRoom, leaveRoom, type RoomSummary } from "../api/rooms";
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
  const [hostSeatIndex, setHostSeatIndex] = useState<number | null>(room.hostSeatIndex);
  const [joinCode, setJoinCode] = useState<string | null>(room.joinCode);
  const [notice, setNotice] = useState<"closed" | "removed" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mySeat = seats.find(
    (p) => (auth?.user && p.userId === auth.user.id) || (auth?.guest && p.guestId === auth.guest.id),
  );
  const isHost = mySeat != null && hostSeatIndex === mySeat.seatIndex;

  useEffect(() => {
    setSeats(room.seats);
    setHostSeatIndex(room.hostSeatIndex);
    setJoinCode(room.joinCode);
    setNotice(null);
  }, [room]);

  const seatsRef = useRef(seats);
  seatsRef.current = seats;

  useEffect(() => {
    let cancelled = false;

    async function apply(next: RoomSummary): Promise<boolean> {
      if (cancelled) return false;
      if (next.status === "playing") {
        onStart();
        return false;
      }
      if (next.status !== "lobby") {
        setNotice("closed");
        return false;
      }
      seatsRef.current = next.seats;
      setSeats(next.seats);
      setHostSeatIndex(next.hostSeatIndex);
      setJoinCode(next.joinCode);
      setError(null);
      return true;
    }

    async function poll() {
      try {
        const ready = seatsRef.current.length === room.playerCount;
        const match = await heartbeatRoom(room.id, ready);
        const stay = await apply(match);
        if (!stay || ready || seatsRef.current.length !== room.playerCount) return;
        const again = await heartbeatRoom(room.id, true);
        await apply(again);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) {
          setNotice("closed");
        } else if (err instanceof ApiError && err.status === 403) {
          setNotice("removed");
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
  }, [room.id, room.playerCount, onStart]);

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
      if (err instanceof ApiError && (err.status === 403 || err.code === "ROOM_NOT_JOINED")) {
        onExit();
        return;
      }
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
        {notice ? (
          <>
            <p className="error">{notice === "removed" ? t("lobbyRemoved") : t("roomClosed")}</p>
            <div className="lobby-actions">
              <button type="button" className="text-btn" onClick={onExit}>
                {t("back")}
              </button>
            </div>
          </>
        ) : (
          <>
            {joinCode && (
              <p className="lobby-code">
                {t("joinCode")}
                <strong>{joinCode}</strong>
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
                    {seat && hostSeatIndex === i && <span className="lobby-host">{t("hostBadge")}</span>}
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
