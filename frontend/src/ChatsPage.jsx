import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PropTypes from "prop-types";
import EmojiPicker from "emoji-picker-react";
import { socket } from "./socket";
import { api } from "./api";
import { useLanguage } from "./context/LanguageContext";
import SettingsBar from "./components/SettingsBar";
import "./style/ChatsPage.css";


function formatTime(createdAt) {
  if (!createdAt) return "";
  const d = typeof createdAt === "number" ? new Date(createdAt) : new Date(createdAt);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatDuration(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function toDayKey(createdAt) {
  const d = typeof createdAt === "number" ? new Date(createdAt) : new Date(createdAt);
  if (Number.isNaN(d.getTime())) return "unknown";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
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


/* ── Voice player sub-component ── */
function VoicePlayer({ src }) {
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (playing) { a.pause(); } else { a.play(); }
  };

  return (
    <div className="voice-player">
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onLoadedMetadata={() => setDuration(audioRef.current?.duration || 0)}
        onTimeUpdate={() => {
          const a = audioRef.current;
          if (a && a.duration) setProgress((a.currentTime / a.duration) * 100);
        }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setProgress(0); }}
      />
      <button className="voice-play-btn" onClick={toggle} type="button" aria-label={playing ? "Pause" : "Play"}>
        {playing ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>
        )}
      </button>
      <div className="voice-track" onClick={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const pct = (e.clientX - rect.left) / rect.width;
        if (audioRef.current && audioRef.current.duration) {
          audioRef.current.currentTime = pct * audioRef.current.duration;
          setProgress(pct * 100);
        }
      }}>
        <div className="voice-track-fill" style={{ width: `${progress}%` }} />
      </div>
      <span className="voice-duration">{formatDuration(duration)}</span>
    </div>
  );
}

VoicePlayer.propTypes = { src: PropTypes.string.isRequired };


const ChatsPage = ({ user, onLogout }) => {
  const { t } = useLanguage();

  const room = (user.room || "general").trim() || "general";
  const me = user.username;

  const [messages, setMessages] = useState([]);
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [typingUser, setTypingUser] = useState(null);
  const [text, setText] = useState("");

  const [contextMenu, setContextMenu] = useState(null);

  const [editingMessage, setEditingMessage] = useState(null); 

  const [replyingTo, setReplyingTo] = useState(null);

  /* ── Emoji picker state ── */
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const emojiPickerRef = useRef(null);

  /* ── Voice recording state ── */
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const recordingTimerRef = useRef(null);

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

  /* ── Close emoji picker on outside click ── */
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(e.target)) {
        setShowEmojiPicker(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const resolveServerMessageId = useCallback((maybeId) => {
    const id = String(maybeId || "");
    if (!id) return null;

    if (!id.startsWith("tmp_")) return id;

    const found = messagesStateRef.current.find((m) => String(m.clientId) === id);
    if (!found) return id;

    return String(found.id || id);
  }, []);

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
            return { ...m, id: mid || m.id, status: "delivered", clientId: cid };
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

    const onMessageEdited = ({ messageId, newText, editedAt }) => {
      if (!mounted) return;
      setMessages((prev) =>
        prev.map((m) => {
          /* Update the edited message itself */
          if (String(m.id) === String(messageId)) {
            return { ...m, text: newText, editedAt };
          }
          /* FIX: Also update any message that has a replyToData pointing to the edited message */
          if (m.replyToData && String(m.replyToData.id) === String(messageId)) {
            return {
              ...m,
              replyToData: { ...m.replyToData, text: truncate(newText, 80) },
            };
          }
          return m;
        })
      );
    };

    const onMessageDeleted = ({ messageId, deletedFor }) => {
      if (!mounted) return;

      if (deletedFor === "me") {
        setMessages((prev) => prev.filter((m) => String(m.id) !== String(messageId)));
      } else {
        setMessages((prev) =>
          prev.map((m) =>
            String(m.id) === String(messageId)
              ? { ...m, text: "", deletedForAll: 1, replyToData: null }
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

  const handleContextMenu = useCallback(
    (e, msg) => {
      if (msg.system) return;
      if (msg.deletedForAll) return;

      if (String(msg.id || "").startsWith("tmp_")) return;
      if (msg.status === "sending") return;

      e.preventDefault();
      setContextMenu({ x: e.clientX, y: e.clientY, message: msg });
    },
    []
  );

  const handleReply = useCallback(() => {
    if (!contextMenu?.message) return;
    const m = contextMenu.message;
    setReplyingTo({ id: m.id, username: m.username, text: m.text });
    setContextMenu(null);
    inputRef.current?.focus();
  }, [contextMenu]);

  const handleStartEdit = useCallback(() => {
    if (!contextMenu?.message) return;
    const m = contextMenu.message;
    if (m.type === "voice") return; // cannot edit voice messages
    setEditingMessage({ id: m.id, text: m.text });
    setText(m.text);
    setReplyingTo(null);
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

  const handleDeleteForMe = useCallback(() => {
    if (!contextMenu?.message) return;
    const realId = resolveServerMessageId(contextMenu.message.id);
    socket.emit("message:delete", { messageId: realId, deleteFor: "me" });
    setContextMenu(null);
  }, [contextMenu, resolveServerMessageId]);

  const handleDeleteForEveryone = useCallback(() => {
    if (!contextMenu?.message) return;
    const realId = resolveServerMessageId(contextMenu.message.id);
    socket.emit("message:delete", { messageId: realId, deleteFor: "everyone" });
    setContextMenu(null);
  }, [contextMenu, resolveServerMessageId]);

  /* ── Emoji handler ── */
  const onEmojiClick = useCallback((emojiData) => {
    setText((prev) => prev + emojiData.emoji);
    inputRef.current?.focus();
  }, []);

  /* ── Voice recording handlers ── */
  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
      audioChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
      setRecordingTime(0);

      recordingTimerRef.current = setInterval(() => {
        setRecordingTime((prev) => prev + 1);
      }, 1000);
    } catch {
      /* user denied mic access */
    }
  }, []);

  const stopRecording = useCallback(() => {
    return new Promise((resolve) => {
      const recorder = mediaRecorderRef.current;
      if (!recorder || recorder.state === "inactive") { resolve(null); return; }

      recorder.onstop = () => {
        recorder.stream?.getTracks().forEach((t) => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        resolve(blob);
      };

      recorder.stop();
      setIsRecording(false);
      clearInterval(recordingTimerRef.current);
    });
  }, []);

  const cancelRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.onstop = () => {
        recorder.stream?.getTracks().forEach((t) => t.stop());
      };
      recorder.stop();
    }
    setIsRecording(false);
    setRecordingTime(0);
    clearInterval(recordingTimerRef.current);
    audioChunksRef.current = [];
  }, []);

  const sendVoice = useCallback(async () => {
    const blob = await stopRecording();
    if (!blob || blob.size === 0) return;

    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = reader.result; // data:audio/webm;base64,...

      shouldAutoScrollRef.current = true;
      const tmpId = `tmp_${Date.now()}_${Math.random().toString(16).slice(2)}`;
      const nowIso = new Date().toISOString();

      const optimistic = {
        id: tmpId,
        room,
        clientId: tmpId,
        username: me,
        text: t("voiceMessage"),
        system: false,
        createdAt: nowIso,
        status: "sending",
        replyTo: replyingTo?.id || null,
        replyToData: replyingTo
          ? { id: replyingTo.id, username: replyingTo.username, text: truncate(replyingTo.text, 80) }
          : null,
        editedAt: null,
        deletedForAll: 0,
        type: "voice",
        voiceUrl: base64,
      };

      setMessages((prev) => mergeMessages(prev, [optimistic]));

      socket.emit("message:send", {
        room,
        text: t("voiceMessage"),
        clientId: tmpId,
        replyTo: replyingTo?.id || null,
        type: "voice",
        voiceData: base64,
      });

      setReplyingTo(null);
      requestAnimationFrame(() => scrollToBottom("smooth"));
    };
    reader.readAsDataURL(blob);
  }, [stopRecording, room, me, replyingTo, scrollToBottom, t]);

  const send = () => {
    const clean = text.trim();
    if (!clean) return;

    if (editingMessage) {
      const realId = resolveServerMessageId(editingMessage.id);
      socket.emit("message:edit", { messageId: realId, newText: clean });
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
      clientId: tmpId,
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
      type: "text",
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
    setShowEmojiPicker(false);
    socket.emit("typing", { room, isTyping: false });

    requestAnimationFrame(() => scrollToBottom("smooth"));
  };

  const labelForDayKey = useCallback((dayKey) => {
    if (dayKey === "unknown") return "";
    const [y, m, d] = dayKey.split("-").map(Number);
    const date = new Date(y, m - 1, d);

    const now = new Date();
    const todayKey = toDayKey(now);
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    const yesterdayKey = toDayKey(yesterday);

    if (dayKey === todayKey) return t("today");
    if (dayKey === yesterdayKey) return t("yesterday");
    return date.toLocaleDateString([], { day: "2-digit", month: "short", year: "numeric" });
  }, [t]);

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
  }, [messages, labelForDayKey]);

  const renderStatus = (m) => {
    if (m.system) return null;
    if (m.username !== me) return null;

    const s = m.status || "delivered";
    if (s === "sending") return <span className="msg-status sending">{t("sendingStatus")}</span>;
    if (s === "delivered") return <span className="msg-status delivered">&#10003;</span>;
    if (s === "seen") {
      return (
        <span className="msg-status seen" title={m.readAt ? `${t("read")}: ${formatTime(m.readAt)}` : t("read")}>
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
              {t("loggedInAs")}<b>{me}</b>
              {typingUser ? <span className="typing">{" · " + typingUser + t("isTyping")}</span> : null}
            </div>
          </div>

          <div className="chat-top-actions">
            <SettingsBar />
            <button className="chat-logout" onClick={onLogout}>
              {t("logout")}
            </button>
          </div>
        </div>

        <div className="chat-body">
          <aside className="chat-users">
            <div className="chat-users-title">{t("online")}</div>
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
              const isVoice = m.type === "voice" && m.voiceUrl;

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
                    {m.replyToData && !isDeleted ? (
                      <div className="msg-reply-preview">
                        <span className="msg-reply-username">{m.replyToData.username}</span>
                        <span className="msg-reply-text">{truncate(m.replyToData.text, 50)}</span>
                      </div>
                    ) : null}

                    {isDeleted ? (
                      <span className="msg-deleted-text">{t("messageDeleted")}</span>
                    ) : isVoice ? (
                      <VoicePlayer src={m.voiceUrl} />
                    ) : (
                      <span>{m.text}</span>
                    )}

                    {m.editedAt && !isDeleted ? (
                      <span className="msg-edited">{t("edited")}</span>
                    ) : null}

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

        {editingMessage ? (
          <div className="edit-banner">
            <div className="edit-banner-bar" />
            <div className="edit-banner-content">
              <span className="edit-banner-label">{t("editMessage")}</span>
            </div>
            <button className="edit-banner-close" onClick={cancelEdit}>&#10005;</button>
          </div>
        ) : null}

        <div className="chat-inputRow">
          {/* Emoji picker toggle */}
          <div className="emoji-picker-wrapper" ref={emojiPickerRef}>
            <button
              className="chat-icon-btn"
              onClick={() => setShowEmojiPicker((p) => !p)}
              type="button"
              aria-label="Emoji"
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/>
                <path d="M8 14s1.5 2 4 2 4-2 4-2"/>
                <line x1="9" y1="9" x2="9.01" y2="9"/>
                <line x1="15" y1="9" x2="15.01" y2="9"/>
              </svg>
            </button>
            {showEmojiPicker ? (
              <div className="emoji-picker-popover">
                <EmojiPicker
                  onEmojiClick={onEmojiClick}
                  width={320}
                  height={400}
                  searchDisabled={false}
                  skinTonesDisabled
                  previewConfig={{ showPreview: false }}
                />
              </div>
            ) : null}
          </div>

          {isRecording ? (
            /* ── Recording UI ── */
            <div className="recording-row">
              <div className="recording-indicator">
                <span className="recording-dot" />
                <span className="recording-label">{t("recording")}</span>
                <span className="recording-timer">{formatDuration(recordingTime)}</span>
              </div>
              <button className="chat-icon-btn recording-cancel" onClick={cancelRecording} type="button" aria-label="Cancel recording">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
              <button className="chat-send" onClick={sendVoice} type="button" aria-label="Send voice">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
              </button>
            </div>
          ) : (
            /* ── Normal input UI ── */
            <>
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
                placeholder={editingMessage ? t("editMessagePlaceholder") : t("writeMessage")}
                autoComplete="off"
              />

              {/* Voice record button (only when no text) */}
              {!text.trim() && !editingMessage ? (
                <button className="chat-icon-btn" onClick={startRecording} type="button" aria-label="Record voice">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                    <line x1="12" y1="19" x2="12" y2="23"/>
                    <line x1="8" y1="23" x2="16" y2="23"/>
                  </svg>
                </button>
              ) : null}

              <button className="chat-send" onClick={send}>
                {editingMessage ? t("save") : t("send")}
              </button>
            </>
          )}
        </div>
      </div>

      {contextMenu ? (
        <div
          className="context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <button className="context-menu-item" onClick={handleReply}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>
            {t("reply")}
          </button>

          {contextMenu.message.username === me && contextMenu.message.type !== "voice" ? (
            <button className="context-menu-item" onClick={handleStartEdit}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              {t("edit")}
            </button>
          ) : null}

          <button className="context-menu-item" onClick={handleDeleteForMe}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            {t("deleteForMe")}
          </button>

          {contextMenu.message.username === me ? (
            <button className="context-menu-item delete" onClick={handleDeleteForEveryone}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
              {t("deleteForEveryone")}
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
