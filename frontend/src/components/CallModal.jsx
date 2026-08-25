import { useEffect, useRef, useState, useCallback } from "react";
import PropTypes from "prop-types";
import { useLanguage } from "../context/LanguageContext";
import "./CallModal.css";

const PhoneIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
    <path d="M6.62 10.79a15.05 15.05 0 0 0 6.59 6.59l2.2-2.2a1 1 0 0 1 1.02-.24c1.12.37 2.33.57 3.57.57a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1C10.61 21 3 13.39 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.24.2 2.45.57 3.57a1 1 0 0 1-.24 1.02l-2.21 2.2z" />
  </svg>
);

const PhoneOffIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
    <path d="M22 3.41 20.59 2 2 20.59 3.41 22l5.18-5.18a15.1 15.1 0 0 0 4.02 1.76 1 1 0 0 0 1.02-.24l2.2-2.2a1 1 0 0 1 1.02-.24c1.12.37 2.33.57 3.57.57a1 1 0 0 0 1-1v-3.5a1 1 0 0 0-1-1 12.6 12.6 0 0 1-2.1-.24L22 3.41zM6.62 10.79c.6 1.15 1.36 2.2 2.25 3.14L4.86 18a15.05 15.05 0 0 1-1.86-7 1 1 0 0 1 1-1H7.5a1 1 0 0 1 1 1c0 .53.05 1.05.14 1.55l-2.02.24z" />
  </svg>
);

const MicIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
    <line x1="12" y1="19" x2="12" y2="23" />
  </svg>
);

const MicOffIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="1" y1="1" x2="23" y2="23" />
    <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
    <path d="M17 16.95A7 7 0 0 1 5 12v-2M19 10v2a7 7 0 0 1-.11 1.23" />
    <line x1="12" y1="19" x2="12" y2="23" />
  </svg>
);

const CameraIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M23 7l-7 5 7 5V7z" />
    <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
  </svg>
);

const CameraOffIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M16 16v1a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2m5 0h4a2 2 0 0 1 2 2v4m0 4l4 3V7l-4 3" />
    <line x1="1" y1="1" x2="23" y2="23" />
  </svg>
);

const SwitchCameraIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 17H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h3l1.5-2h7L17 7h3a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1z" />
    <path d="M15.5 12.5 18 10M18 10l-2.5-2.5M18 10h-4" />
    <circle cx="9.5" cy="12" r="2.3" />
  </svg>
);

const PeopleIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);

const MinimizeIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="4 14 10 14 10 20" />
    <polyline points="20 10 14 10 14 4" />
    <line x1="14" y1="10" x2="21" y2="3" />
    <line x1="3" y1="21" x2="10" y2="14" />
  </svg>
);

const ExpandIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="15 3 21 3 21 9" />
    <polyline points="9 21 3 21 3 15" />
    <line x1="21" y1="3" x2="14" y2="10" />
    <line x1="3" y1="21" x2="10" y2="14" />
  </svg>
);

function formatDuration(startedAt) {
  if (!startedAt) return "00:00";
  const secs = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  const m = String(Math.floor(secs / 60)).padStart(2, "0");
  const s = String(secs % 60).padStart(2, "0");
  return `${m}:${s}`;
}

function RemoteVideoTile({ username, stream, retryToken, onBlockedChange, placeholder }) {
  const videoRef = useRef(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.srcObject = stream || null;
    if (!stream) return;
    const p = el.play();
    if (p && typeof p.then === "function") {
      p.then(() => onBlockedChange(username, false)).catch(() => onBlockedChange(username, true));
    }
  }, [stream, username, onBlockedChange, retryToken]);

  return (
    <div className="call-video-tile">
      {stream ? (
        <video ref={videoRef} autoPlay playsInline />
      ) : (
        <div className="call-tile-placeholder">
          {placeholder || (username || "?").charAt(0).toUpperCase()}
        </div>
      )}
      {username ? <span className="call-tile-name">{username}</span> : null}
    </div>
  );
}

RemoteVideoTile.propTypes = {
  username: PropTypes.string,
  stream: PropTypes.object,
  retryToken: PropTypes.number.isRequired,
  onBlockedChange: PropTypes.func.isRequired,
  placeholder: PropTypes.node,
};

// Audio calls (and video calls before the grid renders) have no <video>
// element to carry the remote MediaStream's audio track — without this the
// call would be silent. Only mounted while the video grid isn't, so a
// video call's tile (which plays the same stream) never double-plays audio.
function RemoteAudioSink({ username, stream, retryToken, onBlockedChange }) {
  const audioRef = useRef(null);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    el.srcObject = stream || null;
    if (!stream) return;
    const p = el.play();
    if (p && typeof p.then === "function") {
      p.then(() => onBlockedChange(username, false)).catch(() => onBlockedChange(username, true));
    }
  }, [stream, username, onBlockedChange, retryToken]);

  return <audio ref={audioRef} autoPlay />;
}

RemoteAudioSink.propTypes = {
  username: PropTypes.string.isRequired,
  stream: PropTypes.object,
  retryToken: PropTypes.number.isRequired,
  onBlockedChange: PropTypes.func.isRequired,
};

function ParticipantList({ me, allOthers, participants, t }) {
  return (
    <div className="call-participant-list">
      {[me, ...allOthers].map((u) => (
        <div key={u} className="call-participant-row">
          <span className="call-participant-dot" />
          <span>{u}</span>
          <span className="call-participant-status">
            {u === me
              ? ""
              : participants[u]?.status === "joined"
                ? t("connected")
                : participants[u]?.status === "ringing"
                  ? t("ringingStatus")
                  : ""}
          </span>
        </div>
      ))}
    </div>
  );
}

ParticipantList.propTypes = {
  me: PropTypes.string.isRequired,
  allOthers: PropTypes.arrayOf(PropTypes.string).isRequired,
  participants: PropTypes.object.isRequired,
  t: PropTypes.func.isRequired,
};

export default function CallModal({
  callState,
  me,
  localStream,
  remoteStreams,
  muted,
  cameraOff,
  canSwitchCamera,
  onAccept,
  onReject,
  onEnd,
  onToggleMute,
  onToggleCamera,
  onSwitchCamera,
}) {
  const { t } = useLanguage();
  const localVideoRef = useRef(null);
  const overlayRef = useRef(null);
  const dragRef = useRef(null);
  const [, forceTick] = useState(0);
  const [blockedTiles, setBlockedTiles] = useState({});
  const [retryToken, setRetryToken] = useState(0);
  const [showParticipants, setShowParticipants] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [widgetPos, setWidgetPos] = useState(null);

  useEffect(() => {
    if (callState.status === "idle") {
      setMinimized(false);
      setWidgetPos(null);
    }
  }, [callState.status]);

  const clampWidgetPos = useCallback((x, y) => {
    const el = overlayRef.current;
    const w = el?.offsetWidth || 130;
    const h = el?.offsetHeight || 170;
    const maxX = Math.max(8, window.innerWidth - w - 8);
    const maxY = Math.max(8, window.innerHeight - h - 8);
    return { x: Math.min(Math.max(8, x), maxX), y: Math.min(Math.max(8, y), maxY) };
  }, []);

  useEffect(() => {
    if (!minimized || !widgetPos) return undefined;
    const onResize = () => setWidgetPos((p) => (p ? clampWidgetPos(p.x, p.y) : p));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [minimized, widgetPos, clampWidgetPos]);

  const onWidgetPointerDown = (e) => {
    if (!minimized) return;
    // Let buttons inside the widget (e.g. the decline call button) handle
    // their own click uninterrupted — capturing the pointer here would
    // retarget its pointerup (and the click derived from it) to the
    // overlay instead of the button.
    if (e.target.closest(".call-btn")) return;
    const el = overlayRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      originX: rect.left,
      originY: rect.top,
      moved: false,
      pointerId: e.pointerId,
    };
    el.setPointerCapture(e.pointerId);
  };

  const onWidgetPointerMove = (e) => {
    const ds = dragRef.current;
    if (!ds || ds.pointerId !== e.pointerId) return;
    const dx = e.clientX - ds.startX;
    const dy = e.clientY - ds.startY;
    if (!ds.moved && Math.hypot(dx, dy) > 6) ds.moved = true;
    if (!ds.moved) return;
    setWidgetPos(clampWidgetPos(ds.originX + dx, ds.originY + dy));
  };

  const onWidgetPointerUp = (e) => {
    const ds = dragRef.current;
    dragRef.current = null;
    if (!ds || ds.pointerId !== e.pointerId) return;
    const el = overlayRef.current;
    if (el?.hasPointerCapture?.(e.pointerId)) el.releasePointerCapture(e.pointerId);
    if (!ds.moved && !e.target.closest(".call-btn")) setMinimized(false);
  };

  const onBlockedChange = useCallback((username, blocked) => {
    setBlockedTiles((prev) => {
      if (!!prev[username] === blocked) return prev;
      return { ...prev, [username]: blocked };
    });
  }, []);

  useEffect(() => {
    const el = localVideoRef.current;
    if (!el) return;
    el.srcObject = localStream || null;
    if (localStream) el.play().catch(() => {});
  }, [localStream]);

  const resumePlayback = () => {
    const local = localVideoRef.current;
    if (local) local.play().catch(() => {});
    setRetryToken((v) => v + 1);
  };

  useEffect(() => {
    if (callState.status !== "active") return undefined;
    const id = setInterval(() => forceTick((v) => v + 1), 1000);
    return () => clearInterval(id);
  }, [callState.status]);

  if (callState.status === "idle") return null;

  const isVideo = callState.callType === "video";
  const isRinging = callState.status === "ringing";
  const isCalling = callState.status === "calling";
  const isConnecting = callState.status === "connecting";
  const isActive = callState.status === "active";
  const hasLocalVideo = !!localStream && localStream.getVideoTracks().length > 0;

  const otherEntries = Object.entries(callState.participants || {}).filter(
    ([u]) => u !== me,
  );
  const allOthers = otherEntries.map(([u]) => u);
  const joinedOthers = otherEntries
    .filter(([, p]) => p.status === "joined")
    .map(([u]) => u);

  const playbackBlocked = Object.values(blockedTiles).some(Boolean);

  // Video call layout shows as soon as our own camera/mic are live
  // (calling/connecting/active), not just once "active" — matches
  // WhatsApp, and means remote video appears the instant it starts
  // flowing. A single placeholder tile keeps the 1:1 caller's own preview
  // full-screen while dialing, exactly like before.
  const showVideoGrid = isVideo && (isCalling || isConnecting || isActive);
  const tileUsernames = joinedOthers.length > 0 ? joinedOthers : [null];
  const tileCount = Math.min(tileUsernames.length, 6);

  const singleOtherName = isRinging ? callState.starter : allOthers[0];

  let statusLabel = "";
  if (isCalling) statusLabel = t("calling");
  else if (isConnecting) statusLabel = t("connecting");
  else if (isActive) statusLabel = formatDuration(callState.startedAt);

  const widgetStyle =
    minimized && widgetPos
      ? { left: widgetPos.x, top: widgetPos.y, right: "auto", bottom: "auto" }
      : undefined;

  return (
    <div
      ref={overlayRef}
      className={`call-overlay ${minimized ? "minimized" : ""}`}
      style={widgetStyle}
      onPointerDown={onWidgetPointerDown}
      onPointerMove={onWidgetPointerMove}
      onPointerUp={onWidgetPointerUp}
      onPointerCancel={onWidgetPointerUp}
    >
      <div
        className={`call-panel ${showVideoGrid ? "video-mode" : ""} ${minimized ? "minimized" : ""}`}
      >
        {!isRinging ? (
          <button
            type="button"
            className="call-minimize-btn"
            onClick={(e) => {
              e.stopPropagation();
              setMinimized((v) => !v);
            }}
            title={minimized ? t("expandCall") : t("minimizeCall")}
          >
            {minimized ? <ExpandIcon /> : <MinimizeIcon />}
          </button>
        ) : null}

        {showVideoGrid ? (
          <>
            <div className="call-video-grid" data-count={tileCount}>
              {tileUsernames.map((u) => (
                <RemoteVideoTile
                  key={u || "__waiting__"}
                  username={u}
                  stream={u ? remoteStreams[u] : null}
                  retryToken={retryToken}
                  onBlockedChange={onBlockedChange}
                  placeholder={u ? undefined : "…"}
                />
              ))}
            </div>
            {hasLocalVideo ? (
              <video
                ref={localVideoRef}
                className="call-video-local"
                autoPlay
                playsInline
                muted
              />
            ) : null}
          </>
        ) : (
          <>
            {Object.entries(remoteStreams).map(([u, s]) => (
              <RemoteAudioSink
                key={`audio-${u}`}
                username={u}
                stream={s}
                retryToken={retryToken}
                onBlockedChange={onBlockedChange}
              />
            ))}
            <div className="call-avatar-wrap">
              {allOthers.length > 1 ? (
                <div className="call-avatar-row">
                  {allOthers.map((u) => (
                    <div
                      key={u}
                      className={`call-avatar small ${
                        callState.participants[u]?.status === "ringing" ? "pulsing" : ""
                      }`}
                    >
                      {(u || "?").charAt(0).toUpperCase()}
                    </div>
                  ))}
                </div>
              ) : (
                <div className={`call-avatar ${isRinging || isCalling ? "pulsing" : ""}`}>
                  {(singleOtherName || "?").charAt(0).toUpperCase()}
                </div>
              )}
              <div className="call-peer-name">
                {allOthers.length > 1 ? allOthers.join(", ") : singleOtherName}
              </div>
              <div className="call-status-label">
                {isRinging
                  ? isVideo
                    ? t("incomingVideoCall")
                    : t("incomingAudioCall")
                  : statusLabel}
              </div>
            </div>
          </>
        )}

        {showVideoGrid ? (
          <div className="call-video-overlay-info">
            {allOthers.length > 0 ? (
              <span className="call-video-peer-name">
                {allOthers.length > 1 ? allOthers.join(", ") : allOthers[0]}
              </span>
            ) : null}
            <div className="call-video-meta-row">
              <span className="call-status-label">{statusLabel}</span>
              {allOthers.length > 0 ? (
                <button
                  type="button"
                  className="call-participant-chip"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowParticipants((v) => !v);
                  }}
                >
                  <PeopleIcon />
                  {allOthers.length + 1}
                </button>
              ) : null}
            </div>
            {showParticipants ? (
              <ParticipantList me={me} allOthers={allOthers} participants={callState.participants} t={t} />
            ) : null}
          </div>
        ) : allOthers.length > 0 ? (
          <div className="call-participants-wrap">
            <button
              type="button"
              className="call-participant-badge"
              onClick={() => setShowParticipants((v) => !v)}
            >
              <PeopleIcon />
              {allOthers.length + 1}
            </button>
            {showParticipants ? (
              <ParticipantList me={me} allOthers={allOthers} participants={callState.participants} t={t} />
            ) : null}
          </div>
        ) : null}

        {playbackBlocked ? (
          <button className="call-resume-playback" onClick={resumePlayback}>
            {t("tapToResumeCall")}
          </button>
        ) : null}

        <div className="call-controls">
          {isRinging ? (
            <>
              <button className="call-btn decline" onClick={onReject} title={t("decline")}>
                <PhoneOffIcon />
              </button>
              <button className="call-btn accept" onClick={onAccept} title={t("accept")}>
                <PhoneIcon />
              </button>
            </>
          ) : (
            <>
              {isActive ? (
                <>
                  <button className={`call-btn secondary ${muted ? "active" : ""}`} onClick={onToggleMute} title={muted ? t("unmute") : t("mute")}>
                    {muted ? <MicOffIcon /> : <MicIcon />}
                  </button>
                  {isVideo ? (
                    <button className={`call-btn secondary ${cameraOff ? "active" : ""}`} onClick={onToggleCamera} title={cameraOff ? t("cameraOn") : t("cameraOff")}>
                      {cameraOff ? <CameraOffIcon /> : <CameraIcon />}
                    </button>
                  ) : null}
                  {isVideo && hasLocalVideo && !cameraOff && canSwitchCamera ? (
                    <button className="call-btn secondary" onClick={onSwitchCamera} title={t("switchCamera")}>
                      <SwitchCameraIcon />
                    </button>
                  ) : null}
                </>
              ) : null}
              <button className="call-btn decline" onClick={onEnd} title={t("endCall")}>
                <PhoneOffIcon />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

CallModal.propTypes = {
  callState: PropTypes.shape({
    status: PropTypes.string.isRequired,
    callType: PropTypes.string.isRequired,
    starter: PropTypes.string,
    participants: PropTypes.object,
    startedAt: PropTypes.number,
  }).isRequired,
  me: PropTypes.string.isRequired,
  localStream: PropTypes.object,
  remoteStreams: PropTypes.object.isRequired,
  muted: PropTypes.bool.isRequired,
  cameraOff: PropTypes.bool.isRequired,
  canSwitchCamera: PropTypes.bool,
  onAccept: PropTypes.func.isRequired,
  onReject: PropTypes.func.isRequired,
  onEnd: PropTypes.func.isRequired,
  onToggleMute: PropTypes.func.isRequired,
  onToggleCamera: PropTypes.func.isRequired,
  onSwitchCamera: PropTypes.func,
};
