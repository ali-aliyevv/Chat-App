// frontend/src/socket.js
import { io } from "socket.io-client";

// Vite env: VITE_API_URL
const URL = import.meta.env.VITE_API_URL || "http://localhost:3001";

export const socket = io(URL, {
  withCredentials: true,
  autoConnect: false,
  transports: ["websocket"],

  reconnection: true,
  reconnectionAttempts: 10,
  reconnectionDelay: 1200,
});

socket.on("connect", () => console.log("🟢 socket connected:", socket.id));
socket.on("disconnect", () => console.log("🔴 socket disconnected"));