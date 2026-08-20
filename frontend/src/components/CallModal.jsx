import { useEffect, useRef, useState } from "react";
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

function formatDuration(startedAt) {
  if (!startedAt) return "00:00";
  const secs = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  const m = String(Math.floor(secs / 60)).padStart(2, "0");
  const s = String(secs % 60).padStart(2, "0");
  return `${m}:${s}`;
}

export default function CallModal({
  callState,
  localStream,
  remoteStream,
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
  const remoteVideoRef = useRef(null);
  const [, forceTick] = useState(0);
  const [playbackBlocked, setPlaybackBlocked] = useState(false);

  useEffect(() => {
    const el = localVideoRef.current;
    if (!el) return;
    el.srcObject = localStream || null;
    if (localStream) el.play().catch(() => {});
  }, [localStream]);

  useEffect(() => {
    const el = remoteVideoRef.current;
    if (!el) return;
    el.srcObject = remoteStream || null;
    if (!remoteStream) {
      setPlaybackBlocked(false);
      return;
    }
    // Mobile browsers can block autoplay of an unmuted <video> (this one
    // carries the call's remote audio) when it isn't tied closely enough
    // to a user gesture — surface a tap-to-resume prompt instead of a
    // silently blank/frozen call screen.
    const playPromise = el.play();
    if (playPromise && typeof playPromise.then === "function") {
      playPromise.then(() => setPlaybackBlocked(false)).catch(() => setPlaybackBlocked(true));
    }
  }, [remoteStream]);

  const resumePlayback = () => {
    const remote = remoteVideoRef.current;
    const local = localVideoRef.current;
    if (local) local.play().catch(() => {});
    if (remote) {
      remote
        .play()
        .then(() => setPlaybackBlocked(false))
        .catch(() => setPlaybackBlocked(true));
    }
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
  // Show the full video layout as soon as our own camera/mic are live
  // (calling/connecting), not just once "active" — matches WhatsApp, and
  // means the remote video appears immediately once it starts flowing.
  const showVideoStage = isVideo && (isCalling || isConnecting || isActive);

  let statusLabel = "";
  if (isCalling) statusLabel = t("calling");
  else if (isConnecting) statusLabel = t("connecting");
  else if (isActive) statusLabel = formatDuration(callState.startedAt);

  return (
    <div className="call-overlay">
      <div className={`call-panel ${showVideoStage ? "video-mode" : ""}`}>
        {showVideoStage ? (
          <>
            <video ref={remoteVideoRef} className="call-video-remote" autoPlay playsInline />
            {hasLocalVideo ? (
              <video ref={localVideoRef} className="call-video-local" autoPlay playsInline muted />
            ) : null}
          </>
        ) : (
          <>
            <video ref={remoteVideoRef} className="call-audio-remote-sink" autoPlay playsInline />
            <div className="call-avatar-wrap">
              <div className={`call-avatar ${isRinging || isCalling ? "pulsing" : ""}`}>
                {(callState.peer || "?").charAt(0).toUpperCase()}
              </div>
              <div className="call-peer-name">{callState.peer}</div>
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

        {showVideoStage ? (
          <div className="call-video-overlay-info">
            <span className="call-peer-name">{callState.peer}</span>
            <span className="call-status-label">{statusLabel}</span>
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
    peer: PropTypes.string,
    startedAt: PropTypes.number,
  }).isRequired,
  localStream: PropTypes.object,
  remoteStream: PropTypes.object,
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
