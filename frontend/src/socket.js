import { io } from "socket.io-client";

const URL = import.meta.env.VITE_API_URL || undefined;

export const socket = io(URL, {
  withCredentials: true,
  autoConnect: false,
  transports: ["polling", "websocket"],

  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  timeout: 10000,
});
