import { io } from "socket.io-client";

const URL = import.meta.env.VITE_API_URL || "https://your-render-url.onrender.com";

export const socket = io(URL, {
  withCredentials: true,
  autoConnect: false,
  transports: ["websocket"],

  reconnection: true,
  reconnectionAttempts: 10,
  reconnectionDelay: 1200,
});
