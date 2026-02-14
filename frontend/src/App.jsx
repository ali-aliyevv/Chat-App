import { useEffect, useState, useCallback } from "react";
import AuthPage from "./AuthPage";
import ChatsPage from "./ChatsPage";
import { api } from "./api";
import "./App.css";

export default function App() {
  const [user, setUser] = useState(null);
  const [pendingRoom, setPendingRoom] = useState(null);
  const [loading, setLoading] = useState(true);

  const resolveInviteIfAny = useCallback(async () => {
    const params = new URLSearchParams(window.location.search);
    const inviteToken = params.get("invite");
    if (!inviteToken) return null;

    try {
      const r = await api.post("/api/invites/resolve", { inviteToken });
      const roomData = r.data?.room;
      const room = String(roomData?.name || roomData?.id || "general").trim() || "general";
      setPendingRoom(room);
      return room;
    } finally {
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  useEffect(() => {
    const boot = async () => {
      try {
        const inviteRoom = await resolveInviteIfAny();

        const me = await api.get("/api/me");
        if (me.data?.authenticated) {
          setUser({ username: me.data.username, room: inviteRoom || "general" });
        } else {
          setUser(null);
        }
      } catch {
        setUser(null);
      } finally {
        setLoading(false);
      }
    };

    boot();
  }, [resolveInviteIfAny]);

  useEffect(() => {
    const onPopState = async () => {
      const room = await resolveInviteIfAny();
      if (room && user?.username) {
        setUser({ username: user.username, room });
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [resolveInviteIfAny, user]);

  const logout = async () => {
    try {
      await api.post("/api/logout");
    } finally {
      setUser(null);
    }
  };

  const handleAuthed = (u) => {
    const room = (u.room || pendingRoom || "general").trim() || "general";
    setUser({ username: u.username, room });
    setPendingRoom(null); 
  };

  if (loading) return null;

  return (
    <div className="app-shell">
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
        <AuthPage onAuthed={handleAuthed} pendingRoom={pendingRoom} />
      )}
    </div>
  );
}
