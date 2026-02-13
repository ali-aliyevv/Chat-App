import { io } from "socket.io-client";

const URL = import.meta.env.VITE_API_URL || "https://render-0-q5lr.onrender.com";

export const socket = io(URL, {
  withCredentials: true,
  autoConnect: false,
  transports: ["websocket", "polling"],

  reconnection: true,
  reconnectionAttempts: 5,
  reconnectionDelay: 2000,
  reconnectionDelayMax: 10000,
  timeout: 10000,
});
