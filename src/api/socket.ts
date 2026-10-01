import { io, type Socket } from "socket.io-client";

let socket: Socket | null = null;

export function getGameSocket(): Socket {
  if (!socket) {
    socket = io({ withCredentials: true });
  }
  return socket;
}
