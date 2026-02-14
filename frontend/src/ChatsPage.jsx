import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PropTypes from "prop-types";
import { socket } from "./socket";
import { api } from "./api";
import "./style/ChatsPage.css";

/* ───── helpers ───── */

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

function truncate(str, len = 50) {
  if (!str) return "";
  return str.length > len ? str.slice(0, len) + "..." : str;
}

/* ───── component ───── */

const ChatsPage = ({ user, onLogout }) => {
  const room = (user.room || "general").trim() || "general";
  const me = user.username;

  const [messages, setMessages] = useState([]);
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [typingUser, setTypingUser] = useState(null);
  const [text, setText] = useState("");

  // Context menu state
  const [contextMenu, setContextMenu] = useState(null); // { x, y, message }

  // Edit state
  const [editingMessage, setEditingMessage] = useState(null); // { id, text }

  // Reply state
  const [replyingTo, setReplyingTo] = useState(null); // { id, username, text }

  const messagesBoxRef = useRef(null);
  const shouldAutoScrollRef = useRef(true);
  const inputRef = useRef(null);

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

  // Close context menu on click anywhere / scroll
  useEffect(() => {
    const close = () => setContextMenu(null);
    document.addEventListener("click", close);
    document.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("click", close);
      document.removeEventListener("scroll", close, true);
    };
  }, []);

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

    const onMessage = (msg) => {
      if (!mounted) return;

      setMessages((prev) => {
        const incoming = msg ? [msg] : [];

        if (msg?.clientId) {
          const clientId = String(msg.clientId);
          const idx = prev.findIndex((m) => String(m.id) === clientId);

          if (idx !== -1) {
            const copy = [...prev];

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

    const onDelivered = ({ clientId, messageId }) => {
      if (!mounted) return;

      setMessages((prev) => {
        const cid = clientId ? String(clientId) : null;
        const mid = messageId ? String(messageId) : null;

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

    const onSeen = ({ readUpTo, readAt }) => {
      if (!mounted) return;
      if (!readUpTo) return;

      setMessages((prev) =>
        prev.map((m) => {
          if (m.system) return m;
          if (m.username !== me) return m;

          const mt = typeof m.createdAt === "number" ? m.createdAt : Date.parse(m.createdAt || 0);
          const rt = typeof readUpTo === "number" ? readUpTo : Date.parse(readUpTo || 0);

          if ((mt || 0) <= (rt || 0)) {
            return { ...m, status: "seen", readAt: readAt || Date.now() };
          }
          return m;
        })
      );
    };

    /* ── New: message:edited ── */
    const onMessageEdited = ({ messageId, newText, editedAt }) => {
      if (!mounted) return;
      setMessages((prev) =>
        prev.map((m) =>
          String(m.id) === String(messageId)
            ? { ...m, text: newText, editedAt }
            : m
        )
      );
    };

    /* ── New: message:deleted ── */
    const onMessageDeleted = ({ messageId, deletedFor }) => {
      if (!mounted) return;

      if (deletedFor === "me") {
        // Remove from local state
        setMessages((prev) => prev.filter((m) => String(m.id) !== String(messageId)));
      } else {
        // "everyone" - replace text with "Bu mesaj silindi"
        setMessages((prev) =>
          prev.map((m) =>
            String(m.id) === String(messageId)
              ? { ...m, text: "Bu mesaj silindi", deletedForAll: 1, replyToData: null }
              : m
          )
        );
      }
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

    socket.off("room:joined");
    socket.off("room:users");
    socket.off("room:history");
    socket.off("message:new");
    socket.off("typing");
    socket.off("message:delivered");
    socket.off("message:seen");
    socket.off("message:edited");
    socket.off("message:deleted");
    socket.off("connect");
    socket.off("connect_error");

    socket.on("room:joined", onJoined);
    socket.on("room:users", onUsers);
    socket.on("room:history", onHistory);
    socket.on("message:new", onMessage);
    socket.on("typing", onTyping);
    socket.on("message:delivered", onDelivered);
    socket.on("message:seen", onSeen);
    socket.on("message:edited", onMessageEdited);
    socket.on("message:deleted", onMessageDeleted);
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
      socket.off("message:edited", onMessageEdited);
      socket.off("message:deleted", onMessageDeleted);
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

  /* ───── context menu handler ───── */
  const handleContextMenu = useCallback(
    (e, msg) => {
      if (msg.system) return; // no context menu for system messages
      if (msg.deletedForAll) return; // no context menu for deleted messages
      e.preventDefault();
      setContextMenu({ x: e.clientX, y: e.clientY, message: msg });
    },
    []
  );

  /* ───── reply ───── */
  const handleReply = useCallback(() => {
    if (!contextMenu?.message) return;
    const m = contextMenu.message;
    setReplyingTo({ id: m.id, username: m.username, text: m.text });
    setContextMenu(null);
    inputRef.current?.focus();
  }, [contextMenu]);

  /* ───── edit ───── */
  const handleStartEdit = useCallback(() => {
    if (!contextMenu?.message) return;
    const m = contextMenu.message;
    setEditingMessage({ id: m.id, text: m.text });
    setText(m.text);
    setReplyingTo(null); // clear reply when editing
    setContextMenu(null);
    inputRef.current?.focus();
  }, [contextMenu]);

  const cancelEdit = useCallback(() => {
    setEditingMessage(null);
    setText("");
  }, []);

  const cancelReply = useCallback(() => {
    setReplyingTo(null);
  }, []);

  /* ───── delete ───── */
  const handleDeleteForMe = useCallback(() => {
    if (!contextMenu?.message) return;
    socket.emit("message:delete", { messageId: contextMenu.message.id, deleteFor: "me" });
    setContextMenu(null);
  }, [contextMenu]);

  const handleDeleteForEveryone = useCallback(() => {
    if (!contextMenu?.message) return;
    socket.emit("message:delete", { messageId: contextMenu.message.id, deleteFor: "everyone" });
    setContextMenu(null);
  }, [contextMenu]);

  /* ───── send / edit submit ───── */
  const send = () => {
    const clean = text.trim();
    if (!clean) return;

    // If editing
    if (editingMessage) {
      socket.emit("message:edit", { messageId: editingMessage.id, newText: clean });
      setEditingMessage(null);
      setText("");
      return;
    }

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
      replyTo: replyingTo?.id || null,
      replyToData: replyingTo
        ? { id: replyingTo.id, username: replyingTo.username, text: truncate(replyingTo.text, 80) }
        : null,
      editedAt: null,
      deletedForAll: 0,
    };

    setMessages((prev) => mergeMessages(prev, [optimistic]));

    socket.emit("message:send", {
      room,
      text: clean,
      clientId: tmpId,
      replyTo: replyingTo?.id || null,
    });

    setText("");
    setReplyingTo(null);
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
    if (s === "sending") return <span className="msg-status sending">Sending...</span>;
    if (s === "delivered") return <span className="msg-status delivered">&#10003;</span>;
    if (s === "seen") {
      return (
        <span className="msg-status seen" title={m.readAt ? `Oxundu: ${formatTime(m.readAt)}` : "Oxundu"}>
          &#10003;&#10003;
        </span>
      );
    }
    return null;
  };

  return (
    <div className="chat-shell">
      <div className="chat-card">
        <div className="chat-top">
          <div>
            <div className="chat-title">{"Room: #" + room}</div>
            <div className="chat-subtitle">
              {"Logged in as "}<b>{me}</b>
              {typingUser ? <span className="typing">{" · " + typingUser + " is typing..."}</span> : null}
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
              const isDeleted = !!m.deletedForAll;

              return (
                <div
                  key={it.key}
                  className={`msg ${m.system ? "system" : isMine ? "mine" : "theirs"}`}
                  onContextMenu={(e) => handleContextMenu(e, m)}
                >
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

                  <div className={`msg-bubble ${isDeleted ? "deleted" : ""}`}>
                    {/* Reply preview */}
                    {m.replyToData && !isDeleted ? (
                      <div className="msg-reply-preview">
                        <span className="msg-reply-username">{m.replyToData.username}</span>
                        <span className="msg-reply-text">{truncate(m.replyToData.text, 50)}</span>
                      </div>
                    ) : null}

                    {isDeleted ? (
                      <span className="msg-deleted-text">Bu mesaj silindi</span>
                    ) : (
                      <span>{m.text}</span>
                    )}

                    {/* Edited marker */}
                    {m.editedAt && !isDeleted ? (
                      <span className="msg-edited">(edited)</span>
                    ) : null}

                    {/* Status + read time for own messages */}
                    {isMine && !isDeleted ? (
                      <div className="msg-statusWrap">
                        {renderStatus(m)}
                        {m.status === "seen" && m.readAt ? (
                          <span className="msg-read-time">{formatTime(m.readAt)}</span>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </section>
        </div>

        {/* Reply banner */}
        {replyingTo ? (
          <div className="reply-banner">
            <div className="reply-banner-bar" />
            <div className="reply-banner-content">
              <span className="reply-banner-username">{replyingTo.username}</span>
              <span className="reply-banner-text">{truncate(replyingTo.text, 60)}</span>
            </div>
            <button className="reply-banner-close" onClick={cancelReply}>&#10005;</button>
          </div>
        ) : null}

        {/* Edit banner */}
        {editingMessage ? (
          <div className="edit-banner">
            <div className="edit-banner-bar" />
            <div className="edit-banner-content">
              <span className="edit-banner-label">Mesaji redakte et</span>
            </div>
            <button className="edit-banner-close" onClick={cancelEdit}>&#10005;</button>
          </div>
        ) : null}

        <div className="chat-inputRow">
          <input
            ref={inputRef}
            className="chat-input"
            value={text}
            onChange={(e) => {
              const v = e.target.value;
              setText(v);
              if (!editingMessage) {
                socket.emit("typing", { room, isTyping: v.trim().length > 0 });
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") send();
              if (e.key === "Escape") {
                if (editingMessage) cancelEdit();
                if (replyingTo) cancelReply();
              }
            }}
            placeholder={editingMessage ? "Yeni mesaj metn..." : "Write a message..."}
            autoComplete="off"
          />

          <button className="chat-send" onClick={send}>
            {editingMessage ? "Save" : "Send"}
          </button>
        </div>
      </div>

      {/* Context Menu */}
      {contextMenu ? (
        <div
          className="context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <button className="context-menu-item" onClick={handleReply}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>
            Reply
          </button>

          {contextMenu.message.username === me ? (
            <button className="context-menu-item" onClick={handleStartEdit}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              Edit
            </button>
          ) : null}

          <button className="context-menu-item" onClick={handleDeleteForMe}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            {"Menim ucun sil"}
          </button>

          {contextMenu.message.username === me ? (
            <button className="context-menu-item delete" onClick={handleDeleteForEveryone}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
            {"Hami ucun sil"}
          </button>
          ) : null}
        </div>
      ) : null}
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
