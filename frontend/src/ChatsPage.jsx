import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PropTypes from "prop-types";
import { socket } from "./socket";
import { api } from "./api";
import "./style/ChatsPage.css";

function formatTime(createdAt) {
  if (!createdAt) return "";
  const d = typeof createdAt === "number" ? new Date(createdAt) : new Date(createdAt);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function toDayKey(createdAt) {
  const d = typeof createdAt === "number" ? new Date(createdAt) : new Date(createdAt);
  if (Number.isNaN(d.getTime())) return "unknown";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function labelForDayKey(dayKey) {
  if (dayKey === "unknown") return "";
  const [y, m, d] = dayKey.split("-").map(Number);
  const date = new Date(y, m - 1, d);

  const now = new Date();
  const todayKey = toDayKey(now);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const yesterdayKey = toDayKey(yesterday);

  if (dayKey === todayKey) return "Today";
  if (dayKey === yesterdayKey) return "Yesterday";
  return date.toLocaleDateString([], { day: "2-digit", month: "short", year: "numeric" });
}

// history + realtime birləşdir, duplicate olmasın
function mergeMessages(prev, incoming) {
  const map = new Map();

  [...prev, ...incoming].forEach((m) => {
    if (!m?.id) return;
    map.set(String(m.id), m);
  });

  return Array.from(map.values()).sort((a, b) => {
    const ta = typeof a.createdAt === "number" ? a.createdAt : Date.parse(a.createdAt || 0);
    const tb = typeof b.createdAt === "number" ? b.createdAt : Date.parse(b.createdAt || 0);
    return (ta || 0) - (tb || 0);
  });
}

function computeReadUpTo(messages, me) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m?.system && m?.username && m.username !== me) {
      return m.createdAt || null;
    }
  }
  return null;
}

const ChatsPage = ({ user, onLogout }) => {
  const room = (user.room || "general").trim() || "general";
  const me = user.username;

  const [messages, setMessages] = useState([]);
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [typingUser, setTypingUser] = useState(null);
  const [text, setText] = useState("");

  const messagesBoxRef = useRef(null);
  const shouldAutoScrollRef = useRef(true);

  const refreshTriedRef = useRef(false);
  const didLogoutRef = useRef(false);
  const historyLoadedRef = useRef(false);

  const lastSeenEmitRef = useRef(null);
  const messagesStateRef = useRef([]);

  useEffect(() => {
    messagesStateRef.current = messages;
  }, [messages]);

  const scrollToBottom = useCallback((behavior = "auto") => {
    const el = messagesBoxRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
  }, []);

  const emitReadUpTo = useCallback(() => {
    const cur = messagesStateRef.current;
    const readUpTo = computeReadUpTo(cur, me);
    if (!readUpTo) return;

    if (String(lastSeenEmitRef.current) === String(readUpTo)) return;
    lastSeenEmitRef.current = readUpTo;

    socket.emit("message:read", { room, readUpTo });
  }, [me, room]);

  const handleMessagesScroll = useCallback(() => {
    const el = messagesBoxRef.current;
    if (!el) return;

    const distanceFromBottom = el.scrollHeight - (el.scrollTop + el.clientHeight);
    shouldAutoScrollRef.current = distanceFromBottom < 120;

    if (shouldAutoScrollRef.current) emitReadUpTo();
  }, [emitReadUpTo]);

  useEffect(() => {
    let mounted = true;
    let typingTimeout = null;

    const forceLogout = () => {
      if (didLogoutRef.current) return;
      didLogoutRef.current = true;

      try {
        socket.off("connect", onConnect);
        socket.off("connect_error", onConnectError);
        socket.disconnect();
      } catch (e) {
        console.debug("socket disconnect failed:", e?.message || e);
      }

      onLogout();
    };

    const onJoined = (payload) => {
      if (!mounted) return;
      setOnlineUsers(payload?.users || []);
    };

    const onUsers = (payload) => {
      if (!mounted) return;
      setOnlineUsers(payload?.users || []);
    };

    const onHistory = (history) => {
      if (!mounted) return;

      const arr = Array.isArray(history) ? history : [];
      setMessages((prev) => mergeMessages(prev, arr));

      if (!historyLoadedRef.current) {
        historyLoadedRef.current = true;
        shouldAutoScrollRef.current = true;

        requestAnimationFrame(() => scrollToBottom("auto"));
        requestAnimationFrame(() => emitReadUpTo());
      }
    };

    // ✅ ƏSAS FIX: server msg clientId göndərirsə optimistic-i replace et
    const onMessage = (msg) => {
      if (!mounted) return;

      setMessages((prev) => {
        const incoming = msg ? [msg] : [];

        // replace optimistic by clientId
        if (msg?.clientId) {
          const clientId = String(msg.clientId);
          const idx = prev.findIndex((m) => String(m.id) === clientId);

          if (idx !== -1) {
            const copy = [...prev];

            // əgər artıq serverId ilə mesaj var -> tmp-ni sil
            const alreadyHasServer = prev.some((m) => String(m.id) === String(msg.id));
            if (alreadyHasServer) {
              copy.splice(idx, 1);
              return mergeMessages(copy, []);
            }

            copy[idx] = {
              ...copy[idx],
              ...msg,
              status: "delivered",
            };

            return mergeMessages(copy, []);
          }
        }

        return mergeMessages(prev, incoming);
      });

      requestAnimationFrame(() => {
        if (shouldAutoScrollRef.current) {
          scrollToBottom("smooth");
          emitReadUpTo();
        }
      });
    };

    const onTyping = ({ username, isTyping }) => {
      if (!mounted) return;

      setTypingUser(isTyping ? username : null);

      if (typingTimeout) clearTimeout(typingTimeout);
      if (isTyping) {
        typingTimeout = setTimeout(() => {
          if (!mounted) return;
          setTypingUser(null);
        }, 1200);
      }
    };

    // ✅ delivered ack
    const onDelivered = ({ clientId, messageId }) => {
      if (!mounted) return;

      setMessages((prev) => {
        const cid = clientId ? String(clientId) : null;
        const mid = messageId ? String(messageId) : null;

        // əgər server msg artıq gəlibsə, tmp-ni sil
        if (cid && mid && prev.some((m) => String(m.id) === mid)) {
          return prev.filter((m) => String(m.id) !== cid);
        }

        return prev.map((m) => {
          if (cid && String(m.id) === cid) {
            return { ...m, id: mid || m.id, status: "delivered" };
          }
          if (!cid && mid && String(m.id) === mid) {
            return { ...m, status: "delivered" };
          }
          return m;
        });
      });
    };

    // ✅ seen
    const onSeen = ({ readUpTo }) => {
      if (!mounted) return;
      if (!readUpTo) return;

      setMessages((prev) =>
        prev.map((m) => {
          if (m.system) return m;
          if (m.username !== me) return m;

          const mt = typeof m.createdAt === "number" ? m.createdAt : Date.parse(m.createdAt || 0);
          const rt = typeof readUpTo === "number" ? readUpTo : Date.parse(readUpTo || 0);

          if ((mt || 0) <= (rt || 0)) return { ...m, status: "seen" };
          return m;
        })
      );
    };

    const onConnect = () => {
      refreshTriedRef.current = false;
      historyLoadedRef.current = false;
      lastSeenEmitRef.current = null;

      socket.emit("auth:join", { room });
    };

    const onConnectError = async () => {
      if (didLogoutRef.current) return;

      if (refreshTriedRef.current) {
        forceLogout();
        return;
      }
      refreshTriedRef.current = true;

      try {
        await api.post("/api/refresh");
        if (!socket.connected) socket.connect();
      } catch {
        forceLogout();
      }
    };

    // HMR cleanup
    socket.off("room:joined");
    socket.off("room:users");
    socket.off("room:history");
    socket.off("message:new");
    socket.off("typing");
    socket.off("message:delivered");
    socket.off("message:seen");
    socket.off("connect");
    socket.off("connect_error");

    socket.on("room:joined", onJoined);
    socket.on("room:users", onUsers);
    socket.on("room:history", onHistory);
    socket.on("message:new", onMessage);
    socket.on("typing", onTyping);
    socket.on("message:delivered", onDelivered);
    socket.on("message:seen", onSeen);
    socket.on("connect", onConnect);
    socket.on("connect_error", onConnectError);

    if (!socket.connected) socket.connect();

    return () => {
      mounted = false;
      if (typingTimeout) clearTimeout(typingTimeout);

      socket.off("room:joined", onJoined);
      socket.off("room:users", onUsers);
      socket.off("room:history", onHistory);
      socket.off("message:new", onMessage);
      socket.off("typing", onTyping);
      socket.off("message:delivered", onDelivered);
      socket.off("message:seen", onSeen);
      socket.off("connect", onConnect);
      socket.off("connect_error", onConnectError);

      try {
        socket.disconnect();
      } catch (e) {
        console.debug("socket.disconnect (cleanup) failed:", e?.message || e);
      }
    };
  }, [room, onLogout, me, scrollToBottom, emitReadUpTo]);

  useEffect(() => {
    if (shouldAutoScrollRef.current) {
      requestAnimationFrame(() => scrollToBottom("smooth"));
    }
  }, [messages.length, scrollToBottom]);

  const send = () => {
    const clean = text.trim();
    if (!clean) return;

    shouldAutoScrollRef.current = true;

    const tmpId = `tmp_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const nowIso = new Date().toISOString();

    const optimistic = {
      id: tmpId,
      room,
      username: me,
      text: clean,
      system: false,
      createdAt: nowIso,
      status: "sending",
    };

    setMessages((prev) => mergeMessages(prev, [optimistic]));

    socket.emit("message:send", { room, text: clean, clientId: tmpId });

    setText("");
    socket.emit("typing", { room, isTyping: false });

    requestAnimationFrame(() => scrollToBottom("smooth"));
  };

  const items = useMemo(() => {
    const out = [];
    let lastDayKey = null;

    for (const m of messages) {
      const dayKey = toDayKey(m.createdAt);
      if (dayKey !== lastDayKey) {
        const label = labelForDayKey(dayKey);
        if (label) out.push({ type: "day", key: `day_${dayKey}`, label });
        lastDayKey = dayKey;
      }
      out.push({ type: "msg", key: `msg_${m.id}`, msg: m });
    }
    return out;
  }, [messages]);

  const renderStatus = (m) => {
    if (m.system) return null;
    if (m.username !== me) return null;

    const s = m.status || "delivered";
    if (s === "sending") return <span className="msg-status">Sending…</span>;
    if (s === "delivered") return <span className="msg-status">✓</span>;
    if (s === "seen") return <span className="msg-status">✓✓ Seen</span>;
    return null;
  };

  return (
    <div className="chat-shell">
      <div className="chat-card">
        <div className="chat-top">
          <div>
            <div className="chat-title">Room: #{room}</div>
            <div className="chat-subtitle">
              Logged in as <b>{me}</b>
              {typingUser ? <span className="typing"> · {typingUser} is typing…</span> : null}
            </div>
          </div>

          <button className="chat-logout" onClick={onLogout}>
            Logout
          </button>
        </div>

        <div className="chat-body">
          <aside className="chat-users">
            <div className="chat-users-title">Online</div>
            <div className="chat-users-list">
              {onlineUsers.map((u) => (
                <div key={u} className={`chat-user ${u === me ? "me" : ""}`}>
                  <span className="dot" />
                  {u}
                </div>
              ))}
            </div>
          </aside>

          <section className="chat-messages" ref={messagesBoxRef} onScroll={handleMessagesScroll}>
            {items.map((it) => {
              if (it.type === "day") {
                return (
                  <div key={it.key} className="msg-day">
                    <span>{it.label}</span>
                  </div>
                );
              }

              const m = it.msg;
              const time = formatTime(m.createdAt);
              const isMine = !m.system && m.username === me;

              return (
                <div key={it.key} className={`msg ${m.system ? "system" : isMine ? "mine" : "theirs"}`}>
                  {!m.system ? (
                    <div className="msg-user">
                      <span>{m.username}</span>
                      {time ? <span style={{ opacity: 0.65, marginLeft: 8, fontSize: 12 }}>{time}</span> : null}
                    </div>
                  ) : time ? (
                    <div className="msg-user" style={{ textAlign: "center" }}>
                      <span style={{ opacity: 0.65, fontSize: 12 }}>{time}</span>
                    </div>
                  ) : null}

                  <div className="msg-bubble">
                    {m.text}
                    {isMine ? <div className="msg-statusWrap">{renderStatus(m)}</div> : null}
                  </div>
                </div>
              );
            })}
          </section>
        </div>

        <div className="chat-inputRow">
          <input
            className="chat-input"
            value={text}
            onChange={(e) => {
              const v = e.target.value;
              setText(v);
              socket.emit("typing", { room, isTyping: v.trim().length > 0 });
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") send();
            }}
            placeholder="Write a message…"
            autoComplete="off"
          />

          <button className="chat-send" onClick={send}>
            Send
          </button>
        </div>
      </div>
    </div>
  );
};

ChatsPage.propTypes = {
  user: PropTypes.shape({
    username: PropTypes.string.isRequired,
    room: PropTypes.string,
  }).isRequired,
  onLogout: PropTypes.func.isRequired,
};

export default ChatsPage;