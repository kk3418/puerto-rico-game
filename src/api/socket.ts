import { io, type Socket } from "socket.io-client";

let socket: Socket | null = null;

export function getGameSocket(): Socket {
  if (!socket) {
    socket = io({ withCredentials: true });
  }
  return socket;
}

/** Drop the cached socket so a changed session re-authenticates on the next watch. */
export function resetGameSocket(): void {
  socket?.disconnect();
  socket = null;
}
