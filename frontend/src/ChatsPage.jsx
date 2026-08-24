import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import PropTypes from "prop-types";
import EmojiPicker from "emoji-picker-react";
import { socket } from "./socket";
import { api } from "./api";
import { useLanguage } from "./context/LanguageContext";
import { useCall } from "./hooks/useCall";
import { useTheme } from "./context/ThemeContext";
import { useViewportClamp } from "./hooks/useViewportClamp";
import { usePushNotifications } from "./hooks/usePushNotifications";
import { useStatus } from "./hooks/useStatus";
import SettingsBar from "./components/SettingsBar";
import CallModal from "./components/CallModal";
import CallHistoryView from "./components/CallHistoryView";
import StatusTab from "./components/StatusTab";
import StatusComposer from "./components/StatusComposer";
import StatusViewer from "./components/StatusViewer";
import ProfileSettingsModal from "./components/ProfileSettingsModal";
import "./style/ChatsPage.css";

function formatTime(createdAt) {
  if (!createdAt) return "";
  const d =
    typeof createdAt === "number" ? new Date(createdAt) : new Date(createdAt);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatDuration(sec) {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function toDayKey(createdAt) {
  const d =
    typeof createdAt === "number" ? new Date(createdAt) : new Date(createdAt);
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
    const ta =
      typeof a.createdAt === "number"
        ? a.createdAt
        : Date.parse(a.createdAt || 0);
    const tb =
      typeof b.createdAt === "number"
        ? b.createdAt
        : Date.parse(b.createdAt || 0);
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

function formatFileSize(bytes) {
  if (bytes === null || bytes === undefined || Number.isNaN(bytes)) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const BOT_USERNAME = "🤖 Bot";
const MAX_VIDEO_NOTE_SECONDS = 60;

const AttachIcon = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
  </svg>
);

const CallAudioIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
    <path d="M6.62 10.79a15.05 15.05 0 0 0 6.59 6.59l2.2-2.2a1 1 0 0 1 1.02-.24c1.12.37 2.33.57 3.57.57a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1C10.61 21 3 13.39 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.24.2 2.45.57 3.57a1 1 0 0 1-.24 1.02l-2.21 2.2z" />
  </svg>
);

const CallVideoIcon = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polygon points="23 7 16 12 23 17 23 7" />
    <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
  </svg>
);

const ReplyIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="9 17 4 12 9 7" />
    <path d="M20 18v-2a4 4 0 0 0-4-4H4" />
  </svg>
);

const InfoIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="16" x2="12" y2="12" />
    <line x1="12" y1="8" x2="12.01" y2="8" />
  </svg>
);

const StarIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
  </svg>
);

const DocIcon = () => (
  <svg
    width="22"
    height="22"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
  </svg>
);

/* ── Voice player sub-component ── */
function VoicePlayer({ src }) {
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (playing) {
      a.pause();
    } else {
      a.play();
    }
  };

  return (
    <div className="voice-player">
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onLoadedMetadata={() => {
          const a = audioRef.current;
          if (!a) return;
          if (Number.isFinite(a.duration)) {
            setDuration(a.duration);
            return;
          }
          // Chrome/Android reports Infinity for MediaRecorder webm blobs
          // until the real duration is forced to resolve by seeking past
          // the end once, then back to the start.
          const onTimeUpdate = () => {
            a.removeEventListener("timeupdate", onTimeUpdate);
            setDuration(Number.isFinite(a.duration) ? a.duration : 0);
            a.currentTime = 0;
          };
          a.addEventListener("timeupdate", onTimeUpdate);
          a.currentTime = 1e7;
        }}
        onDurationChange={() => {
          const a = audioRef.current;
          if (a && Number.isFinite(a.duration)) setDuration(a.duration);
        }}
        onTimeUpdate={() => {
          const a = audioRef.current;
          if (a && Number.isFinite(a.duration) && a.duration > 0) {
            setProgress((a.currentTime / a.duration) * 100);
          }
        }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setProgress(0);
        }}
      />
      <button
        className="voice-play-btn"
        onClick={toggle}
        type="button"
        aria-label={playing ? "Pause" : "Play"}
      >
        {playing ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="4" width="4" height="16" rx="1" />
            <rect x="14" y="4" width="4" height="16" rx="1" />
          </svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <polygon points="5,3 19,12 5,21" />
          </svg>
        )}
      </button>
      <div
        className="voice-track"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const pct = (e.clientX - rect.left) / rect.width;
          if (audioRef.current && audioRef.current.duration) {
            audioRef.current.currentTime = pct * audioRef.current.duration;
            setProgress(pct * 100);
          }
        }}
      >
        <div className="voice-track-fill" style={{ width: `${progress}%` }} />
      </div>
      <span className="voice-duration">{formatDuration(duration)}</span>
    </div>
  );
}

VoicePlayer.propTypes = { src: PropTypes.string.isRequired };

const ChatsPage = ({ user, onLogout }) => {
  const { t } = useLanguage();
  const { resolved: resolvedTheme } = useTheme();

  const room = (user.room || "general").trim() || "general";
  const me = user.username;

  const [messages, setMessages] = useState([]);
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [typingUser, setTypingUser] = useState(null);
  const [text, setText] = useState("");

  const [contextMenu, setContextMenu] = useState(null);
  const contextMenuRef = useRef(null);
  const [infoPopover, setInfoPopover] = useState(null);
  const infoPopoverRef = useRef(null);
  const longPressTimerRef = useRef(null);
  const longPressStartPosRef = useRef({ x: 0, y: 0 });
  const suppressNextCloseRef = useRef(false);
  const swipeStateRef = useRef({
    active: false,
    msgId: null,
    startX: 0,
    startY: 0,
    decided: false,
    horizontal: false,
    dx: 0,
  });
  const msgRowRefs = useRef(new Map());

  const [activeTab, setActiveTab] = useState("chat");
  const [callHistory, setCallHistory] = useState([]);

  const [editingMessage, setEditingMessage] = useState(null);

  const [replyingTo, setReplyingTo] = useState(null);

  const [uploadError, setUploadError] = useState(null);
  const [callErrorMsg, setCallErrorMsg] = useState(null);

  const call = useCall(me);
  const pushNotifications = usePushNotifications();
  const status = useStatus(me);

  /* ── Profile (avatar/about) ── */
  const [myProfile, setMyProfile] = useState({ avatarUrl: null, about: null });
  const [showProfileModal, setShowProfileModal] = useState(false);

  useEffect(() => {
    let mounted = true;
    api
      .get("/api/me")
      .then((res) => {
        if (!mounted) return;
        setMyProfile({
          avatarUrl: res.data?.avatarUrl || null,
          about: res.data?.about || null,
        });
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  const handleSaveProfile = useCallback(async ({ avatarUrl, about }) => {
    const res = await api.patch("/api/me/profile", { avatarUrl, about });
    setMyProfile({
      avatarUrl: res.data?.avatarUrl || null,
      about: res.data?.about || null,
    });
  }, []);

  const handleChangePassword = useCallback(async (currentPassword, newPassword) => {
    await api.post("/api/me/password", { currentPassword, newPassword });
  }, []);

  /* ── Status (24h updates) ── */
  const [showStatusComposer, setShowStatusComposer] = useState(false);
  const [viewerUsername, setViewerUsername] = useState(null);

  const viewerGroup = useMemo(() => {
    if (!viewerUsername) return null;
    if (viewerUsername === me) {
      return { username: me, avatarUrl: myProfile.avatarUrl, items: status.mine };
    }
    return status.othersGrouped.find((g) => g.username === viewerUsername) || null;
  }, [viewerUsername, me, myProfile.avatarUrl, status.mine, status.othersGrouped]);
  /* ── Emoji picker state ── */
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [emojiPickerWidth, setEmojiPickerWidth] = useState(320);
  const emojiPickerRef = useRef(null);

  /* ── Sticker tray state ── */
  const [pickerTab, setPickerTab] = useState("emoji");
  const [stickers, setStickers] = useState([]);
  const stickersLoadedRef = useRef(false);
  const stickerFileInputRef = useRef(null);

  /* ── Voice recording state ── */
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const recordingTimerRef = useRef(null);

  /* ── Video note (round video message) recording state ── */
  const [isVideoRecording, setIsVideoRecording] = useState(false);
  const [videoRecordingTime, setVideoRecordingTime] = useState(0);
  const videoRecorderRef = useRef(null);
  const videoChunksRef = useRef([]);
  const videoRecordingTimerRef = useRef(null);
  const videoLivePreviewRef = useRef(null);

  const messagesBoxRef = useRef(null);
  const shouldAutoScrollRef = useRef(true);
  const inputRef = useRef(null);
  const fileInputRef = useRef(null);

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
      if (
        emojiPickerRef.current &&
        !emojiPickerRef.current.contains(e.target)
      ) {
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

    const found = messagesStateRef.current.find(
      (m) => String(m.clientId) === id,
    );
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

    const distanceFromBottom =
      el.scrollHeight - (el.scrollTop + el.clientHeight);
    shouldAutoScrollRef.current = distanceFromBottom < 120;

    if (shouldAutoScrollRef.current) emitReadUpTo();
  }, [emitReadUpTo]);

  useEffect(() => {
    if (!call.callState.error) return;
    setCallErrorMsg(t(call.callState.error));
    call.clearError();
    const timer = setTimeout(() => setCallErrorMsg(null), 4000);
    return () => clearTimeout(timer);
  }, [call, call.callState.error, t]);

  const otherOnlineUser = useMemo(
    () => onlineUsers.find((u) => u !== me) || null,
    [onlineUsers, me],
  );

  const handleAudioCall = useCallback(() => {
    if (!otherOnlineUser) {
      setCallErrorMsg(t("noOneToCall"));
      setTimeout(() => setCallErrorMsg(null), 4000);
      return;
    }
    call.startCall(room, "audio");
  }, [call, otherOnlineUser, room, t]);

  const handleVideoCall = useCallback(() => {
    if (!otherOnlineUser) {
      setCallErrorMsg(t("noOneToCall"));
      setTimeout(() => setCallErrorMsg(null), 4000);
      return;
    }
    call.startCall(room, "video");
  }, [call, otherOnlineUser, room, t]);

  useEffect(() => {
    const close = () => {
      // The synthetic click that follows the touchend of a long-press
      // would otherwise immediately close the menu we just opened.
      if (suppressNextCloseRef.current) {
        suppressNextCloseRef.current = false;
        return;
      }
      setContextMenu(null);
      setInfoPopover(null);
    };
    document.addEventListener("click", close);
    document.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("click", close);
      document.removeEventListener("scroll", close, true);
    };
  }, []);

  useViewportClamp(contextMenuRef, contextMenu, setContextMenu);
  useViewportClamp(infoPopoverRef, infoPopover, setInfoPopover);

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
      }

      // Fires on every room:history, not just the first — a reconnect (app
      // reopened after being backgrounded/closed) resends the full history
      // but was previously only marked read on the very first load, so a
      // message that arrived while the app was closed never got its seen
      // receipt even after the recipient actually looked at it.
      if (shouldAutoScrollRef.current) {
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

            const alreadyHasServer = prev.some(
              (m) => String(m.id) === String(msg.id),
            );
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
            return {
              ...m,
              id: mid || m.id,
              status: "delivered",
              clientId: cid,
            };
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

          const mt =
            typeof m.createdAt === "number"
              ? m.createdAt
              : Date.parse(m.createdAt || 0);
          const rt =
            typeof readUpTo === "number" ? readUpTo : Date.parse(readUpTo || 0);

          if ((mt || 0) <= (rt || 0)) {
            return { ...m, status: "seen", readAt: readAt || Date.now() };
          }
          return m;
        }),
      );
    };

    const onDeliveredReceipt = ({ deliveredUpTo, deliveredAt }) => {
      if (!mounted || !deliveredUpTo) return;
      setMessages((prev) =>
        prev.map((m) => {
          if (m.system || m.username !== me || m.deliveredAt) return m;
          const mt =
            typeof m.createdAt === "number"
              ? m.createdAt
              : Date.parse(m.createdAt || 0);
          if ((mt || 0) <= deliveredUpTo) {
            return { ...m, deliveredAt: deliveredAt || Date.now() };
          }
          return m;
        }),
      );
    };

    const onCallHistory = (rows) => {
      if (!mounted) return;
      setCallHistory(Array.isArray(rows) ? rows : []);
    };

    const onCallHistoryUpdate = (row) => {
      if (!mounted || !row?.id) return;
      setCallHistory((prev) => {
        const idx = prev.findIndex((r) => r.id === row.id);
        const next =
          idx === -1
            ? [row, ...prev]
            : prev.map((r) => (r.id === row.id ? row : r));
        return next.sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
      });
    };

    const onMessageEdited = ({ messageId, newText, editedAt }) => {
      if (!mounted) return;
      setMessages((prev) =>
        prev.map((m) => {
          /* Update the edited message itself */
          if (String(m.id) === String(messageId)) {
            return { ...m, text: newText, editedAt };
          }
          /* Also update any message that has a replyToData pointing to the edited message */
          if (m.replyToData && String(m.replyToData.id) === String(messageId)) {
            return {
              ...m,
              replyToData: { ...m.replyToData, text: truncate(newText, 80) },
            };
          }
          return m;
        }),
      );
    };

    const onMessageDeleted = ({ messageId, deletedFor }) => {
      if (!mounted) return;

      if (deletedFor === "me") {
        setMessages((prev) =>
          prev.filter((m) => String(m.id) !== String(messageId)),
        );
      } else {
        setMessages((prev) =>
          prev.map((m) =>
            String(m.id) === String(messageId)
              ? { ...m, text: "", deletedForAll: 1, replyToData: null }
              : m,
          ),
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
    socket.off("message:deliveredReceipt");
    socket.off("message:edited");
    socket.off("message:deleted");
    socket.off("call:history");
    socket.off("call:history:update");
    socket.off("connect");
    socket.off("connect_error");

    socket.on("room:joined", onJoined);
    socket.on("room:users", onUsers);
    socket.on("room:history", onHistory);
    socket.on("message:new", onMessage);
    socket.on("typing", onTyping);
    socket.on("message:delivered", onDelivered);
    socket.on("message:seen", onSeen);
    socket.on("message:deliveredReceipt", onDeliveredReceipt);
    socket.on("message:edited", onMessageEdited);
    socket.on("message:deleted", onMessageDeleted);
    socket.on("call:history", onCallHistory);
    socket.on("call:history:update", onCallHistoryUpdate);
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
      socket.off("message:deliveredReceipt", onDeliveredReceipt);
      socket.off("message:edited", onMessageEdited);
      socket.off("message:deleted", onMessageDeleted);
      socket.off("call:history", onCallHistory);
      socket.off("call:history:update", onCallHistoryUpdate);
      socket.off("connect", onConnect);
      socket.off("connect_error", onConnectError);

      try {
        socket.disconnect();
      } catch (e) {
        console.debug("socket.disconnect (cleanup) failed:", e?.message || e);
      }
    };
  }, [room, onLogout, me, scrollToBottom, emitReadUpTo]);

  // Let the server know whether this tab is actually being looked at, so it
  // can decide whether an incoming message needs a push notification. A
  // connected socket alone isn't enough — mobile browsers/PWAs keep the
  // connection alive for a while after being backgrounded or closed, during
  // which the server would otherwise think the user is "online" and skip
  // the push even though nothing is visibly showing the message.
  useEffect(() => {
    const emitVisibility = () => {
      if (!socket.connected) return;
      socket.emit("presence:visibility", {
        visible: document.visibilityState === "visible",
      });
    };
    emitVisibility();
    document.addEventListener("visibilitychange", emitVisibility);
    socket.on("connect", emitVisibility);
    return () => {
      document.removeEventListener("visibilitychange", emitVisibility);
      socket.off("connect", emitVisibility);
    };
  }, []);

  // Covers the case where the socket never actually dropped (so no fresh
  // room:history arrives to trigger the catch-up above) — just switching
  // apps and back on mobile, or alt-tabbing on desktop, without a real
  // disconnect. Whatever's already loaded and scrolled to the bottom gets
  // marked read now that the tab is actually being looked at again.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible" && shouldAutoScrollRef.current) {
        emitReadUpTo();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [emitReadUpTo]);

  useEffect(() => {
    if (shouldAutoScrollRef.current) {
      requestAnimationFrame(() => scrollToBottom("smooth"));
    }
  }, [messages.length, scrollToBottom]);

  const canOpenMenuFor = useCallback((msg) => {
    if (msg.system) return false;
    if (msg.deletedForAll) return false;
    if (String(msg.id || "").startsWith("tmp_")) return false;
    if (msg.status === "sending") return false;
    return true;
  }, []);

  const handleContextMenu = useCallback(
    (e, msg) => {
      if (!canOpenMenuFor(msg)) return;
      e.preventDefault();
      setContextMenu({ x: e.clientX, y: e.clientY, message: msg });
    },
    [canOpenMenuFor],
  );

  // Mobile browsers don't reliably fire "contextmenu" from a long-press,
  // so drive the same menu from a manual touch-and-hold timer instead
  // (WhatsApp-style).
  const clearLongPress = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const handleTouchStart = useCallback(
    (e, msg) => {
      if (!canOpenMenuFor(msg)) return;
      const touch = e.touches[0];
      if (!touch) return;
      longPressStartPosRef.current = { x: touch.clientX, y: touch.clientY };

      swipeStateRef.current = {
        active: true,
        msgId: msg.id,
        startX: touch.clientX,
        startY: touch.clientY,
        decided: false,
        horizontal: false,
        dx: 0,
      };

      clearLongPress();
      longPressTimerRef.current = setTimeout(() => {
        longPressTimerRef.current = null;
        suppressNextCloseRef.current = true;
        if (navigator.vibrate) navigator.vibrate(15);
        setContextMenu({ x: touch.clientX, y: touch.clientY, message: msg });
      }, 500);
    },
    [canOpenMenuFor, clearLongPress],
  );

  const SWIPE_MAX = 90;
  const SWIPE_THRESHOLD = 64;

  const handleTouchMove = useCallback(
    (e, msg) => {
      const touch = e.touches[0];
      if (!touch) return;
      const dx0 = touch.clientX - longPressStartPosRef.current.x;
      const dy0 = touch.clientY - longPressStartPosRef.current.y;
      if (Math.hypot(dx0, dy0) > 10) clearLongPress();

      const s = swipeStateRef.current;
      if (!s.active || s.msgId !== msg.id) return;
      const dx = touch.clientX - s.startX;
      const dy = touch.clientY - s.startY;

      if (!s.decided) {
        if (Math.hypot(dx, dy) < 10) return;
        s.decided = true;
        s.horizontal = Math.abs(dx) > Math.abs(dy) * 1.3;
      }
      if (!s.horizontal) return;

      s.dx = dx;
      const el = msgRowRefs.current.get(msg.id);
      if (el) {
        const clamped = Math.max(-SWIPE_MAX, Math.min(SWIPE_MAX, dx));
        el.style.transition = "none";
        el.style.transform = `translateX(${clamped}px)`;

        const isMine = !msg.system && msg.username === me;
        const action = isMine
          ? dx < 0
            ? "reply"
            : "info"
          : dx > 0
            ? "reply"
            : null;
        const intensity = String(Math.min(1, Math.abs(clamped) / SWIPE_THRESHOLD));
        const row = el.closest(".msg");
        const replyIcon = row?.querySelector(".msg-swipe-icon.reply");
        const infoIcon = row?.querySelector(".msg-swipe-icon.info");
        if (replyIcon) replyIcon.style.opacity = action === "reply" ? intensity : "0";
        if (infoIcon) infoIcon.style.opacity = action === "info" ? intensity : "0";
      }
    },
    [clearLongPress, me],
  );

  const getSwipeAction = useCallback((isMine, dx) => {
    if (isMine) return dx < 0 ? "reply" : "info";
    // Delivered/read info is only meaningful for messages you sent — a
    // received message has no "info" swipe action.
    return dx > 0 ? "reply" : null;
  }, []);

  const openMessageInfo = useCallback((msg, x, y) => {
    setInfoPopover({ x, y, message: msg });
  }, []);

  const replyToMessage = useCallback((msg) => {
    setReplyingTo({ id: msg.id, username: msg.username, text: msg.text });
    inputRef.current?.focus();
  }, []);

  const handleSwipeEnd = useCallback(
    (msg) => {
      clearLongPress();
      const s = swipeStateRef.current;
      const el = msgRowRefs.current.get(msg.id);

      if (s.active && s.msgId === msg.id && s.horizontal) {
        if (Math.abs(s.dx) > SWIPE_THRESHOLD) {
          const isMine = !msg.system && msg.username === me;
          const action = getSwipeAction(isMine, s.dx);
          if (action === "reply") {
            replyToMessage(msg);
          } else if (action === "info") {
            const rect = el?.getBoundingClientRect();
            openMessageInfo(
              msg,
              rect ? rect.left + rect.width / 2 : 0,
              rect ? rect.top : 0,
            );
          }
        }
      }

      if (el) {
        el.style.transition = "transform 0.2s ease";
        el.style.transform = "translateX(0)";
        const row = el.closest(".msg");
        row?.querySelectorAll(".msg-swipe-icon").forEach((icon) => {
          icon.style.opacity = "0";
        });
        setTimeout(() => {
          el.style.transition = "";
        }, 220);
      }
      swipeStateRef.current = {
        active: false,
        msgId: null,
        startX: 0,
        startY: 0,
        decided: false,
        horizontal: false,
        dx: 0,
      };
    },
    [clearLongPress, me, getSwipeAction, replyToMessage, openMessageInfo],
  );

  const handleReply = useCallback(() => {
    if (!contextMenu?.message) return;
    replyToMessage(contextMenu.message);
    setContextMenu(null);
  }, [contextMenu, replyToMessage]);

  const handleShowInfo = useCallback(() => {
    if (!contextMenu?.message) return;
    openMessageInfo(contextMenu.message, contextMenu.x, contextMenu.y);
    setContextMenu(null);
  }, [contextMenu, openMessageInfo]);

  const handleStartEdit = useCallback(() => {
    if (!contextMenu?.message) return;
    const m = contextMenu.message;
    if (["voice", "sticker", "video_note"].includes(m.type)) return; // media-only messages aren't editable
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

  /* ── Sticker handlers ── */
  const loadStickers = useCallback(async () => {
    if (stickersLoadedRef.current) return;
    stickersLoadedRef.current = true;
    try {
      const res = await api.get("/api/stickers");
      setStickers(Array.isArray(res.data) ? res.data : []);
    } catch {
      stickersLoadedRef.current = false;
    }
  }, []);

  const handleStickerFileChange = useCallback(
    async (e) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;

      if (file.size > MAX_ATTACHMENT_BYTES) {
        setUploadError(t("fileTooLarge"));
        setTimeout(() => setUploadError(null), 4000);
        return;
      }

      try {
        const formData = new FormData();
        formData.append("file", file);
        const uploadRes = await api.post("/api/upload", formData);
        const { url, name } = uploadRes.data;
        const stickerRes = await api.post("/api/stickers", { url, name });
        setStickers((prev) => [stickerRes.data, ...prev]);
      } catch {
        setUploadError(t("uploadFailed"));
        setTimeout(() => setUploadError(null), 4000);
      }
    },
    [t],
  );

  const handleDeleteSticker = useCallback(async (id) => {
    setStickers((prev) => prev.filter((s) => s.id !== id));
    try {
      await api.delete(`/api/stickers/${id}`);
    } catch {
      /* sticker tray will resync on next open if this silently failed */
    }
  }, []);

  // "Favorite" a sticker seen in the chat (yours or theirs) into your own
  // tray, same as WhatsApp's "add to my stickers". Refetches first so the
  // dedupe check isn't fooled by a stale/never-loaded local sticker list.
  const handleFavoriteSticker = useCallback(async (msg) => {
    if (!msg?.attachmentUrl) return;
    try {
      const res = await api.get("/api/stickers");
      const existing = Array.isArray(res.data) ? res.data : [];
      stickersLoadedRef.current = true;

      if (existing.some((s) => s.url === msg.attachmentUrl)) {
        setStickers(existing);
        return;
      }
      const stickerRes = await api.post("/api/stickers", {
        url: msg.attachmentUrl,
        name: msg.attachmentName || "sticker",
      });
      setStickers([stickerRes.data, ...existing]);
    } catch {
      setUploadError(t("uploadFailed"));
      setTimeout(() => setUploadError(null), 4000);
    }
  }, [t]);

  const sendSticker = useCallback(
    (sticker) => {
      shouldAutoScrollRef.current = true;
      const tmpId = `tmp_${Date.now()}_${Math.random().toString(16).slice(2)}`;
      const nowIso = new Date().toISOString();
      const replyToId = replyingTo?.id || null;

      const optimistic = {
        id: tmpId,
        room,
        clientId: tmpId,
        username: me,
        text: "",
        system: false,
        createdAt: nowIso,
        status: "sending",
        replyTo: replyToId,
        replyToData: replyingTo
          ? {
              id: replyingTo.id,
              username: replyingTo.username,
              text: truncate(replyingTo.text, 80),
            }
          : null,
        editedAt: null,
        deletedForAll: 0,
        type: "sticker",
        attachmentUrl: sticker.url,
        attachmentName: sticker.name || "sticker",
        attachmentType: "image/*",
        attachmentSize: null,
      };

      setMessages((prev) => mergeMessages(prev, [optimistic]));
      setReplyingTo(null);
      setShowEmojiPicker(false);
      requestAnimationFrame(() => scrollToBottom("smooth"));

      socket.emit("message:send", {
        room,
        text: "",
        clientId: tmpId,
        replyTo: replyToId,
        type: "sticker",
        attachment: {
          url: sticker.url,
          name: sticker.name || "sticker",
          type: "image/*",
          size: null,
        },
      });
    },
    [room, me, replyingTo, scrollToBottom],
  );

  /* ── Voice recording handlers ── */
  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, {
        mimeType: "audio/webm;codecs=opus",
      });
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
      if (!recorder || recorder.state === "inactive") {
        resolve(null);
        return;
      }

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
          ? {
              id: replyingTo.id,
              username: replyingTo.username,
              text: truncate(replyingTo.text, 80),
            }
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

  /* ── Video note (round video message, Telegram/WhatsApp style) ── */
  const stopVideoRecording = useCallback(() => {
    return new Promise((resolve) => {
      const recorder = videoRecorderRef.current;
      if (!recorder || recorder.state === "inactive") {
        resolve(null);
        return;
      }

      recorder.onstop = () => {
        recorder.stream?.getTracks().forEach((tr) => tr.stop());
        const blob = new Blob(videoChunksRef.current, {
          type: recorder.mimeType || "video/webm",
        });
        resolve(blob);
      };

      recorder.stop();
      setIsVideoRecording(false);
      clearInterval(videoRecordingTimerRef.current);
    });
  }, []);

  const cancelVideoRecording = useCallback(() => {
    const recorder = videoRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.onstop = () => {
        recorder.stream?.getTracks().forEach((tr) => tr.stop());
      };
      recorder.stop();
    }
    setIsVideoRecording(false);
    setVideoRecordingTime(0);
    clearInterval(videoRecordingTimerRef.current);
    videoChunksRef.current = [];
  }, []);

  const sendVideoNote = useCallback(async () => {
    const blob = await stopVideoRecording();
    setVideoRecordingTime(0);
    if (!blob || blob.size === 0) return;

    shouldAutoScrollRef.current = true;
    const tmpId = `tmp_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const nowIso = new Date().toISOString();
    const replyToId = replyingTo?.id || null;
    const localPreviewUrl = URL.createObjectURL(blob);

    const optimistic = {
      id: tmpId,
      room,
      clientId: tmpId,
      username: me,
      text: "",
      system: false,
      createdAt: nowIso,
      status: "uploading",
      replyTo: replyToId,
      replyToData: replyingTo
        ? {
            id: replyingTo.id,
            username: replyingTo.username,
            text: truncate(replyingTo.text, 80),
          }
        : null,
      editedAt: null,
      deletedForAll: 0,
      type: "video_note",
      attachmentUrl: localPreviewUrl,
      attachmentName: "video_note.webm",
      attachmentType: blob.type || "video/webm",
      attachmentSize: blob.size,
    };

    setMessages((prev) => mergeMessages(prev, [optimistic]));
    setReplyingTo(null);
    requestAnimationFrame(() => scrollToBottom("smooth"));

    try {
      const file = new File([blob], "video_note.webm", {
        type: blob.type || "video/webm",
      });
      const formData = new FormData();
      formData.append("file", file);
      const res = await api.post("/api/upload", formData);
      const { url, name, type, size } = res.data;

      setMessages((prev) =>
        prev.map((m) =>
          String(m.id) === tmpId
            ? { ...m, status: "sending", attachmentUrl: url }
            : m,
        ),
      );

      socket.emit("message:send", {
        room,
        text: "",
        clientId: tmpId,
        replyTo: replyToId,
        type: "video_note",
        attachment: { url, name, type, size },
      });
    } catch {
      setMessages((prev) => prev.filter((m) => String(m.id) !== tmpId));
      setUploadError(t("uploadFailed"));
      setTimeout(() => setUploadError(null), 4000);
    }
  }, [stopVideoRecording, room, me, replyingTo, scrollToBottom, t]);

  const startVideoRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user" },
        audio: true,
      });
      const mimeCandidates = [
        "video/webm;codecs=vp9,opus",
        "video/webm;codecs=vp8,opus",
        "video/webm",
        "video/mp4",
      ];
      const mimeType = mimeCandidates.find((c) =>
        window.MediaRecorder?.isTypeSupported?.(c),
      );
      const recorder = new MediaRecorder(
        stream,
        mimeType ? { mimeType } : undefined,
      );
      videoChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) videoChunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((tr) => tr.stop());
      };

      videoRecorderRef.current = recorder;
      recorder.start();
      setIsVideoRecording(true);
      setVideoRecordingTime(0);

      // Auto-send once the cap is hit, matching WhatsApp/Telegram's video
      // notes rather than leaving the recorder running indefinitely.
      videoRecordingTimerRef.current = setInterval(() => {
        setVideoRecordingTime((prev) => {
          const next = prev + 1;
          if (next >= MAX_VIDEO_NOTE_SECONDS) {
            clearInterval(videoRecordingTimerRef.current);
            sendVideoNote();
          }
          return next;
        });
      }, 1000);
    } catch {
      /* user denied camera/mic access */
    }
  }, [sendVideoNote]);

  // The live preview <video> only exists in the DOM once isVideoRecording
  // flips true and React re-renders — binding srcObject synchronously
  // inside startVideoRecording() ran before that render committed, so the
  // ref was always null. Bind it here instead, once it's actually mounted.
  useEffect(() => {
    if (!isVideoRecording) return;
    const el = videoLivePreviewRef.current;
    const stream = videoRecorderRef.current?.stream;
    if (!el || !stream) return;
    el.srcObject = stream;
    el.play().catch(() => {});
  }, [isVideoRecording]);

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
        ? {
            id: replyingTo.id,
            username: replyingTo.username,
            text: truncate(replyingTo.text, 80),
          }
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

  const handleAttachClick = useCallback(() => {
    if (editingMessage) return;
    fileInputRef.current?.click();
  }, [editingMessage]);

  const handleFileChange = useCallback(
    async (e) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;

      if (file.size > MAX_ATTACHMENT_BYTES) {
        setUploadError(t("fileTooLarge"));
        setTimeout(() => setUploadError(null), 4000);
        return;
      }

      shouldAutoScrollRef.current = true;

      const tmpId = `tmp_${Date.now()}_${Math.random().toString(16).slice(2)}`;
      const nowIso = new Date().toISOString();
      const isImage = file.type.startsWith("image/");
      const isVideo = file.type.startsWith("video/");
      const localPreviewUrl = isImage || isVideo ? URL.createObjectURL(file) : null;
      const caption = text.trim();
      const replyToId = replyingTo?.id || null;

      const optimistic = {
        id: tmpId,
        room,
        clientId: tmpId,
        username: me,
        text: caption,
        system: false,
        createdAt: nowIso,
        status: "uploading",
        replyTo: replyToId,
        replyToData: replyingTo
          ? {
              id: replyingTo.id,
              username: replyingTo.username,
              text: truncate(replyingTo.text, 80),
            }
          : null,
        editedAt: null,
        deletedForAll: 0,
        attachmentUrl: localPreviewUrl,
        attachmentName: file.name,
        attachmentType: file.type || "application/octet-stream",
        attachmentSize: file.size,
      };

      setMessages((prev) => mergeMessages(prev, [optimistic]));
      setText("");
      setReplyingTo(null);
      socket.emit("typing", { room, isTyping: false });
      requestAnimationFrame(() => scrollToBottom("smooth"));

      try {
        const formData = new FormData();
        formData.append("file", file);
        const res = await api.post("/api/upload", formData);
        const { url, name, type, size } = res.data;

        setMessages((prev) =>
          prev.map((m) =>
            String(m.id) === tmpId
              ? { ...m, status: "sending", attachmentUrl: url }
              : m,
          ),
        );

        socket.emit("message:send", {
          room,
          text: caption,
          clientId: tmpId,
          replyTo: replyToId,
          attachment: { url, name, type, size },
        });
      } catch {
        setMessages((prev) => prev.filter((m) => String(m.id) !== tmpId));
        setUploadError(t("uploadFailed"));
        setTimeout(() => setUploadError(null), 4000);
      } finally {
        if (localPreviewUrl) URL.revokeObjectURL(localPreviewUrl);
      }
    },
    [me, replyingTo, room, scrollToBottom, t, text],
  );

  const labelForDayKey = useCallback(
    (dayKey) => {
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
      return date.toLocaleDateString([], {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
    },
    [t],
  );

  // For system (join/leave) messages coming from the server, prefer the
  // translated systemKey ("{user} qoşuldu" / "joined" / "присоединился")
  // and fall back to the raw English text for old rows that predate this.
  const getDisplayText = useCallback(
    (m) => {
      if (m.system && m.systemKey) {
        return t(m.systemKey, { user: m.systemUser });
      }
      return m.text;
    },
    [t],
  );

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

  // "seen" is derived from the persistent m.readAt (survives a history
  // reload on reconnect) rather than the ephemeral m.status string the
  // server never sends back — status is only meaningful for the local,
  // pre-ack "sending" state.
  const renderStatus = (m) => {
    if (m.system) return null;
    if (m.username !== me) return null;

    if (m.status === "sending")
      return <span className="msg-status sending">{t("sendingStatus")}</span>;
    if (m.readAt) {
      return (
        <span
          className="msg-status seen"
          title={`${t("read")}: ${formatTime(m.readAt)}`}
        >
          &#10003;&#10003;
        </span>
      );
    }
    return <span className="msg-status delivered">&#10003;</span>;
  };

  return (
    <div className="chat-shell">
      <div className="chat-card">
        <div className="chat-top">
          <div>
            <div className="chat-title">{"Room: #" + room}</div>
            <div className="chat-subtitle">
              {t("loggedInAs")}
              <b>{me}</b>
              {typingUser ? (
                <span className="typing">
                  {" · " + typingUser + t("isTyping")}
                </span>
              ) : null}
            </div>
          </div>

          <div className="chat-top-actions">
            <button
              className="chat-call-btn"
              onClick={handleAudioCall}
              disabled={call.callState.status !== "idle"}
              title={t("audioCall")}
            >
              <CallAudioIcon />
            </button>
            <button
              className="chat-call-btn"
              onClick={handleVideoCall}
              disabled={call.callState.status !== "idle"}
              title={t("videoCall")}
            >
              <CallVideoIcon />
            </button>
            <SettingsBar
              pushNotifications={pushNotifications}
              onOpenProfile={() => setShowProfileModal(true)}
            />
            <button className="chat-logout" onClick={onLogout}>
              {t("logout")}
            </button>
          </div>
        </div>

        {callErrorMsg ? (
          <div className="call-toast-banner">{callErrorMsg}</div>
        ) : null}

        <div className="chat-tabs">
          <button
            type="button"
            className={`chat-tab ${activeTab === "chat" ? "active" : ""}`}
            onClick={() => setActiveTab("chat")}
          >
            {t("chatsTab")}
          </button>
          <button
            type="button"
            className={`chat-tab ${activeTab === "calls" ? "active" : ""}`}
            onClick={() => setActiveTab("calls")}
          >
            {t("callsTab")}
          </button>
          <button
            type="button"
            className={`chat-tab ${activeTab === "status" ? "active" : ""}`}
            onClick={() => setActiveTab("status")}
          >
            {t("statusTab")}
          </button>
        </div>

        {activeTab === "calls" ? (
          <CallHistoryView
            callHistory={callHistory}
            me={me}
            onCallBack={(callType) => {
              setActiveTab("chat");
              call.startCall(room, callType);
            }}
          />
        ) : activeTab === "status" ? (
          <StatusTab
            me={me}
            myAvatarUrl={myProfile.avatarUrl}
            mine={status.mine}
            othersGrouped={status.othersGrouped}
            onAddClick={() => setShowStatusComposer(true)}
            onOpenViewer={(g) => setViewerUsername(g.username)}
          />
        ) : (
          <>
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

          <section
            className="chat-messages"
            ref={messagesBoxRef}
            onScroll={handleMessagesScroll}
          >
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
              const isBot = !m.system && m.username === BOT_USERNAME;
              const isDeleted = !!m.deletedForAll;
              const isVoice = m.type === "voice" && m.voiceUrl;
              const isSticker = m.type === "sticker" && m.attachmentUrl;
              const isVideoNote = m.type === "video_note" && m.attachmentUrl;
              const displayText = getDisplayText(m);

              return (
                <div
                  key={it.key}
                  className={`msg ${m.system ? "system" : isMine ? "mine" : "theirs"} ${isBot ? "bot" : ""}`}
                  onContextMenu={(e) => handleContextMenu(e, m)}
                  onTouchStart={(e) => handleTouchStart(e, m)}
                  onTouchMove={(e) => handleTouchMove(e, m)}
                  onTouchEnd={() => handleSwipeEnd(m)}
                  onTouchCancel={() => handleSwipeEnd(m)}
                >
                  {!m.system && !isDeleted ? (
                    <>
                      <span
                        className={`msg-swipe-icon reply ${isMine ? "side-right" : "side-left"}`}
                      >
                        <ReplyIcon />
                      </span>
                      {/* Delivered/read info only makes sense for messages
                          you sent — a received message has nothing of the
                          sort to show, so the swipe-to-info side is only
                          wired up (and shown) on your own messages. */}
                      {isMine ? (
                        <span className="msg-swipe-icon info side-left">
                          <InfoIcon />
                        </span>
                      ) : null}
                    </>
                  ) : null}
                  {!m.system ? (
                    <div className="msg-user">
                      <span>{m.username}</span>
                      {time ? (
                        <span
                          style={{ opacity: 0.65, marginLeft: 8, fontSize: 12 }}
                        >
                          {time}
                        </span>
                      ) : null}
                    </div>
                  ) : time ? (
                    <div className="msg-user" style={{ textAlign: "center" }}>
                      <span style={{ opacity: 0.65, fontSize: 12 }}>
                        {time}
                      </span>
                    </div>
                  ) : null}

                  <div
                    className={`msg-bubble ${isDeleted ? "deleted" : ""} ${isSticker && !isDeleted ? "sticker" : ""} ${isVideoNote && !isDeleted ? "video-note" : ""}`}
                    ref={(el) => {
                      if (el) msgRowRefs.current.set(m.id, el);
                      else msgRowRefs.current.delete(m.id);
                    }}
                  >
                    {m.replyToData && !isDeleted ? (
                      <div className="msg-reply-preview">
                        <span className="msg-reply-username">
                          {m.replyToData.username}
                        </span>
                        <span className="msg-reply-text">
                          {truncate(m.replyToData.text, 50)}
                        </span>
                      </div>
                    ) : null}

                    {isDeleted ? (
                      <span className="msg-deleted-text">
                        {t("messageDeleted")}
                      </span>
                    ) : isSticker ? (
                      <img
                        src={m.attachmentUrl}
                        alt={m.attachmentName || "sticker"}
                        className="msg-sticker-image"
                      />
                    ) : isVideoNote ? (
                      <video
                        src={m.attachmentUrl}
                        controls
                        playsInline
                        className="msg-video-note"
                      />
                    ) : isVoice ? (
                      <VoicePlayer src={m.voiceUrl} />
                    ) : (
                      <>
                        {m.attachmentUrl ? (
                          m.attachmentType?.startsWith("image/") ? (
                            <a
                              href={m.attachmentUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="msg-attachment-image-link"
                              onClick={(e) =>
                                m.status === "uploading" && e.preventDefault()
                              }
                            >
                              <img
                                src={m.attachmentUrl}
                                alt={m.attachmentName || "image"}
                                className="msg-attachment-image"
                              />
                            </a>
                          ) : m.attachmentType?.startsWith("video/") ? (
                            <video
                              src={m.attachmentUrl}
                              controls
                              playsInline
                              className="msg-attachment-video"
                            />
                          ) : (
                            <a
                              href={m.attachmentUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="msg-attachment-doc"
                              onClick={(e) =>
                                m.status === "uploading" && e.preventDefault()
                              }
                            >
                              <span className="msg-attachment-doc-icon">
                                <DocIcon />
                              </span>
                              <span className="msg-attachment-doc-info">
                                <span className="msg-attachment-doc-name">
                                  {m.attachmentName}
                                </span>
                                <span className="msg-attachment-doc-size">
                                  {formatFileSize(m.attachmentSize)}
                                </span>
                              </span>
                            </a>
                          )
                        ) : null}

                        {m.status === "uploading" ? (
                          <span className="msg-attachment-uploading">
                            {t("uploading")}
                          </span>
                        ) : null}

                        {displayText ? (
                          <span
                            className={
                              m.attachmentUrl
                                ? "msg-attachment-caption"
                                : undefined
                            }
                          >
                            {displayText}
                          </span>
                        ) : null}
                      </>
                    )}

                    {m.editedAt && !isDeleted ? (
                      <span className="msg-edited">{t("edited")}</span>
                    ) : null}

                    {isMine && !isDeleted ? (
                      <div className="msg-statusWrap">
                        {renderStatus(m)}
                        {m.readAt ? (
                          <span className="msg-read-time">
                            {formatTime(m.readAt)}
                          </span>
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
              <span className="reply-banner-username">
                {replyingTo.username}
              </span>
              <span className="reply-banner-text">
                {truncate(replyingTo.text, 60)}
              </span>
            </div>
            <button className="reply-banner-close" onClick={cancelReply}>
              &#10005;
            </button>
          </div>
        ) : null}

        {editingMessage ? (
          <div className="edit-banner">
            <div className="edit-banner-bar" />
            <div className="edit-banner-content">
              <span className="edit-banner-label">{t("editMessage")}</span>
            </div>
            <button className="edit-banner-close" onClick={cancelEdit}>
              &#10005;
            </button>
          </div>
        ) : null}

        {uploadError ? (
          <div className="upload-error-banner">{uploadError}</div>
        ) : null}

        <div className="chat-inputRow">
          <input
            ref={fileInputRef}
            type="file"
            onChange={handleFileChange}
            style={{ display: "none" }}
          />

          <button
            type="button"
            className="chat-attach"
            onClick={handleAttachClick}
            disabled={!!editingMessage}
            title={t("attach")}
          >
            <AttachIcon />
          </button>

          {isRecording ? (
            /* ── Recording UI ── */
            <div className="recording-row">
              <div className="recording-indicator">
                <span className="recording-dot" />
                <span className="recording-label">{t("recording")}</span>
                <span className="recording-timer">
                  {formatDuration(recordingTime)}
                </span>
              </div>
              <button
                className="chat-icon-btn recording-cancel"
                onClick={cancelRecording}
                type="button"
                aria-label="Cancel recording"
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
              <button
                className="chat-send"
                onClick={sendVoice}
                type="button"
                aria-label="Send voice"
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="22" y1="2" x2="11" y2="13" />
                  <polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              </button>
            </div>
          ) : isVideoRecording ? (
            /* ── Video note recording UI ── */
            <div className="recording-row video-recording-row">
              <div className="video-recording-preview-wrap">
                <video
                  ref={videoLivePreviewRef}
                  className="video-recording-preview"
                  muted
                  playsInline
                  autoPlay
                />
                <span className="recording-dot video-recording-dot" />
              </div>
              <span className="recording-timer">
                {formatDuration(videoRecordingTime)} / {formatDuration(MAX_VIDEO_NOTE_SECONDS)}
              </span>
              <button
                className="chat-icon-btn recording-cancel"
                onClick={cancelVideoRecording}
                type="button"
                aria-label="Cancel video recording"
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
              <button
                className="chat-send"
                onClick={sendVideoNote}
                type="button"
                aria-label="Send video note"
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="22" y1="2" x2="11" y2="13" />
                  <polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
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
                    socket.emit("typing", {
                      room,
                      isTyping: v.trim().length > 0,
                    });
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") send();
                  if (e.key === "Escape") {
                    if (editingMessage) cancelEdit();
                    if (replyingTo) cancelReply();
                  }
                }}
                placeholder={
                  editingMessage
                    ? t("editMessagePlaceholder")
                    : t("writeMessage")
                }
                autoComplete="off"
              />

              {/* Voice record button (only when no text) */}
              {!text.trim() && !editingMessage ? (
                <button
                  className="chat-icon-btn"
                  onClick={startRecording}
                  type="button"
                  aria-label="Record voice"
                >
                  <svg
                    width="22"
                    height="22"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                    <line x1="12" y1="19" x2="12" y2="23" />
                    <line x1="8" y1="23" x2="16" y2="23" />
                  </svg>
                </button>
              ) : null}

              {/* Video note record button (only when no text) */}
              {!text.trim() && !editingMessage ? (
                <button
                  className="chat-icon-btn"
                  onClick={startVideoRecording}
                  type="button"
                  aria-label="Record video note"
                  title={t("recordVideoNote")}
                >
                  <svg
                    width="22"
                    height="22"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polygon points="23 7 16 12 23 17 23 7" />
                    <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                  </svg>
                </button>
              ) : null}

              {/* Emoji/sticker picker toggle - right side */}
              <div className="emoji-picker-wrapper" ref={emojiPickerRef}>
                <button
                  className="chat-icon-btn"
                  onClick={() => {
                    setEmojiPickerWidth(Math.min(320, window.innerWidth - 24));
                    setShowEmojiPicker((p) => !p);
                    loadStickers();
                  }}
                  type="button"
                  aria-label="Emoji"
                >
                  <svg
                    width="22"
                    height="22"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <circle cx="12" cy="12" r="10" />
                    <path d="M8 14s1.5 2 4 2 4-2 4-2" />
                    <line x1="9" y1="9" x2="9.01" y2="9" />
                    <line x1="15" y1="9" x2="15.01" y2="9" />
                  </svg>
                </button>
                {showEmojiPicker ? (
                  <div className="emoji-picker-popover">
                    <div className="picker-tabs">
                      <button
                        type="button"
                        className={`picker-tab ${pickerTab === "emoji" ? "active" : ""}`}
                        onClick={() => setPickerTab("emoji")}
                      >
                        {t("emojiTab")}
                      </button>
                      <button
                        type="button"
                        className={`picker-tab ${pickerTab === "stickers" ? "active" : ""}`}
                        onClick={() => setPickerTab("stickers")}
                      >
                        {t("stickersTab")}
                      </button>
                    </div>

                    {pickerTab === "emoji" ? (
                      <EmojiPicker
                        key={emojiPickerWidth}
                        onEmojiClick={onEmojiClick}
                        width={emojiPickerWidth}
                        height={360}
                        searchDisabled={false}
                        skinTonesDisabled
                        previewConfig={{ showPreview: false }}
                        theme={resolvedTheme === "dark" ? "dark" : "light"}
                      />
                    ) : (
                      <div className="sticker-grid" style={{ width: emojiPickerWidth }}>
                        <input
                          ref={stickerFileInputRef}
                          type="file"
                          accept="image/*"
                          onChange={handleStickerFileChange}
                          style={{ display: "none" }}
                        />
                        <button
                          type="button"
                          className="sticker-add-tile"
                          onClick={() => stickerFileInputRef.current?.click()}
                          title={t("addSticker")}
                        >
                          +
                        </button>
                        {stickers.length === 0 ? (
                          <div className="sticker-empty">{t("noStickersYet")}</div>
                        ) : (
                          stickers.map((s) => (
                            <div key={s.id} className="sticker-tile">
                              <button
                                type="button"
                                className="sticker-tile-btn"
                                onClick={() => sendSticker(s)}
                              >
                                <img src={s.url} alt={s.name || "sticker"} />
                              </button>
                              <button
                                type="button"
                                className="sticker-tile-remove"
                                onClick={() => handleDeleteSticker(s.id)}
                                title={t("deleteSticker")}
                              >
                                &#10005;
                              </button>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                ) : null}
              </div>

              <button
                className="chat-send"
                onClick={send}
                aria-label={editingMessage ? t("save") : t("send")}
              >
                {editingMessage ? (
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : (
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                  >
                    <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
                  </svg>
                )}
              </button>
            </>
          )}
        </div>
          </>
        )}
      </div>

      {contextMenu ? (
        <div
          ref={contextMenuRef}
          className="context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <button className="context-menu-item" onClick={handleReply}>
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="9 17 4 12 9 7" />
              <path d="M20 18v-2a4 4 0 0 0-4-4H4" />
            </svg>
            {t("reply")}
          </button>

          {contextMenu.message.type === "sticker" ? (
            <button
              className="context-menu-item"
              onClick={() => {
                handleFavoriteSticker(contextMenu.message);
                setContextMenu(null);
              }}
            >
              <StarIcon />
              {t("addToMyStickers")}
            </button>
          ) : null}

          {contextMenu.message.username === me ? (
            <button className="context-menu-item" onClick={handleShowInfo}>
              <InfoIcon />
              {t("messageInfo")}
            </button>
          ) : null}

          {contextMenu.message.username === me &&
          !["voice", "sticker", "video_note"].includes(contextMenu.message.type) ? (
            <button className="context-menu-item" onClick={handleStartEdit}>
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
              {t("edit")}
            </button>
          ) : null}

          <button className="context-menu-item" onClick={handleDeleteForMe}>
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
            {t("deleteForMe")}
          </button>

          {contextMenu.message.username === me ? (
            <button
              className="context-menu-item delete"
              onClick={handleDeleteForEveryone}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                <line x1="10" y1="11" x2="10" y2="17" />
                <line x1="14" y1="11" x2="14" y2="17" />
              </svg>
              {t("deleteForEveryone")}
            </button>
          ) : null}
        </div>
      ) : null}

      {infoPopover ? (
        <div
          ref={infoPopoverRef}
          className="context-menu msg-info-popover"
          style={{ top: infoPopover.y, left: infoPopover.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="msg-info-title">{t("messageInfo")}</div>
          <div className="msg-info-row">
            <span className="msg-info-label">{t("sentAt")}</span>
            <span className="msg-info-value">
              {formatTime(infoPopover.message.createdAt) || "—"}
            </span>
          </div>
          <div className="msg-info-row">
            <span className="msg-info-label">{t("deliveredAt")}</span>
            <span className="msg-info-value">
              {infoPopover.message.deliveredAt
                ? formatTime(infoPopover.message.deliveredAt)
                : t("notDeliveredYet")}
            </span>
          </div>
          <div className="msg-info-row">
            <span className="msg-info-label">{t("read")}</span>
            <span className="msg-info-value">
              {infoPopover.message.readAt
                ? formatTime(infoPopover.message.readAt)
                : t("notReadYet")}
            </span>
          </div>
        </div>
      ) : null}

      <CallModal
        callState={call.callState}
        me={me}
        localStream={call.localStream}
        remoteStreams={call.remoteStreams}
        muted={call.muted}
        cameraOff={call.cameraOff}
        canSwitchCamera={call.canSwitchCamera}
        facingMode={call.facingMode}
        onAccept={call.acceptCall}
        onReject={call.rejectCall}
        onEnd={call.endCall}
        onToggleMute={call.toggleMute}
        onToggleCamera={call.toggleCamera}
        onSwitchCamera={call.switchCamera}
      />

      {showProfileModal ? (
        <ProfileSettingsModal
          me={me}
          avatarUrl={myProfile.avatarUrl}
          about={myProfile.about}
          onClose={() => setShowProfileModal(false)}
          onSaveProfile={handleSaveProfile}
          onChangePassword={handleChangePassword}
        />
      ) : null}

      {showStatusComposer ? (
        <StatusComposer
          onClose={() => setShowStatusComposer(false)}
          onCreateText={status.createTextStatus}
          onCreateMedia={status.createMediaStatus}
        />
      ) : null}

      {viewerGroup ? (
        <StatusViewer
          group={viewerGroup}
          me={me}
          onClose={() => setViewerUsername(null)}
          onView={status.viewStatus}
          onDelete={status.deleteStatus}
          getViewers={status.getViewers}
        />
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