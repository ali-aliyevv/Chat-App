import { useEffect, useState } from "react";
import AuthPage from "./AuthPage";
import ChatsPage from "./ChatsPage";
import { api } from "./api";
import "./App.css";

const ROOM_KEY = "rt_room";

export default function App() {
  const [user, setUser] = useState(null); // { username, room }
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const checkSession = async () => {
      try {
        const r = await api.get("/api/me");

        if (r.data?.authenticated) {
          const savedRoom = localStorage.getItem(ROOM_KEY) || "general";
          setUser({ username: r.data.username, room: savedRoom });
        } else {
          setUser(null);
        }
      } catch {
        // buraya artıq düşməməlidir, amma yenə də safety
        setUser(null);
      } finally {
        setLoading(false);
      }
    };

    checkSession();
  }, []);

  const logout = async () => {
    try {
      await api.post("/api/logout");
    } finally {
      setUser(null);
    }
  };

  const handleAuthed = (u) => {
    const room = (u.room || "general").trim() || "general";
    localStorage.setItem(ROOM_KEY, room);
    setUser({ username: u.username, room });
  };

  if (loading) return null;

  return (
    <div className="app-shell">
      {/* Global animated background */}
      <div className="fx-bg" aria-hidden="true">
        <div className="fx-blob fx-blob--a" />
        <div className="fx-blob fx-blob--b" />
        <div className="fx-blob fx-blob--c" />
        <div className="fx-grid" />
        <div className="fx-noise" />
      </div>

      {user ? (
        <ChatsPage user={user} onLogout={logout} />
      ) : (
        <AuthPage onAuthed={handleAuthed} />
      )}
    </div>
  );
}
