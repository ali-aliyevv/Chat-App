import { useCallback, useEffect, useRef, useState } from "react";
import { socket } from "../socket";
import { startRingtone, stopRingtone } from "../utils/ringtone";

const ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  // Public TURN relay (Open Relay Project) — required so calls can connect
  // when peers are behind NAT/CGNAT (e.g. two phones on different mobile
  // networks), where STUN alone cannot establish connectivity.
  { urls: "stun:stun.relay.metered.ca:80" },
  {
    urls: "turn:global.relay.metered.ca:80",
    username: "openrelayproject",
    credential: "openrelayproject",
  },
  {
    urls: "turn:global.relay.metered.ca:443",
    username: "openrelayproject",
    credential: "openrelayproject",
  },
  {
    urls: "turn:global.relay.metered.ca:443?transport=tcp",
    username: "openrelayproject",
    credential: "openrelayproject",
  },
];

const CONNECT_TIMEOUT_MS = 20000;

const CAMERA_FALLBACK_ERRORS = [
  "NotFoundError",
  "DevicesNotFoundError",
  "OverconstrainedError",
  "NotReadableError",
  "TrackStartError",
];

async function acquireLocalMedia(wantVideo) {
  if (!wantVideo) {
    return {
      stream: await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      }),
      videoFallback: false,
    };
  }
  try {
    return {
      stream: await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: true,
      }),
      videoFallback: false,
    };
  } catch (err) {
    if (!CAMERA_FALLBACK_ERRORS.includes(err?.name)) throw err;
    // No usable camera on this device — keep the call alive as audio-only
    // instead of rejecting/ending it; other participants can still send video.
    return {
      stream: await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      }),
      videoFallback: true,
    };
  }
}

function snapshotToObject(arr) {
  const obj = {};
  (arr || []).forEach((p) => {
    obj[p.username] = { status: p.status };
  });
  return obj;
}

const IDLE_STATE = {
  status: "idle", // idle | ringing | calling | connecting | active
  callId: null,
  callType: "audio",
  isStarter: false,
  starter: null,
  participants: {}, // { [username]: { status: 'ringing'|'joined'|'declined'|'left' } }
  error: null,
  startedAt: null,
};

// useCall(me) — `me` (own username) is needed to tell "my own join
// confirmation" apart from "someone else joined" in the group-call
// participant events, and to compute how many other joined peers remain.
export function useCall(me) {
  const [callState, setCallState] = useState(IDLE_STATE);
  const [localStream, setLocalStream] = useState(null);
  const [remoteStreams, setRemoteStreams] = useState({});
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [canSwitchCamera, setCanSwitchCamera] = useState(false);
  const [facingMode, setFacingMode] = useState("user");

  const callStateRef = useRef(callState);
  const localStreamRef = useRef(null);
  const pcMapRef = useRef(new Map()); // username -> RTCPeerConnection
  const pendingCandidatesRef = useRef(new Map()); // username -> candidate[]
  const connectTimersRef = useRef(new Map()); // username -> timeout handle
  const facingModeRef = useRef("user");
  const hasJoinedRef = useRef(false); // am I a joined participant of the current call?

  useEffect(() => {
    callStateRef.current = callState;
  }, [callState]);

  const stopLocalStream = useCallback(() => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((tr) => tr.stop());
    }
    localStreamRef.current = null;
    setLocalStream(null);
  }, []);

  const cleanup = useCallback(() => {
    pcMapRef.current.forEach((pc) => {
      pc.onicecandidate = null;
      pc.ontrack = null;
      pc.onconnectionstatechange = null;
      pc.oniceconnectionstatechange = null;
      try {
        pc.close();
      } catch {
        /* ignore */
      }
    });
    pcMapRef.current.clear();
    connectTimersRef.current.forEach((timer) => clearTimeout(timer));
    connectTimersRef.current.clear();
    pendingCandidatesRef.current.clear();
    hasJoinedRef.current = false;

    stopLocalStream();
    setRemoteStreams({});
    setMuted(false);
    setCameraOff(false);
    setCanSwitchCamera(false);
    facingModeRef.current = "user";
    setFacingMode("user");
  }, [stopLocalStream]);

  const resetToIdle = useCallback(
    (errorKey = null) => {
      cleanup();
      setCallState({ ...IDLE_STATE, error: errorKey });
    },
    [cleanup],
  );

  const clearError = useCallback(() => {
    setCallState((s) => ({ ...s, error: null }));
  }, []);

  // Called when a specific peer connection dies (failed/closed/timed out)
  // rather than the server telling us they left. Drops just that one tile;
  // if I have no other joined peers left afterward, I proactively leave the
  // call too (mirrors the old 1:1 "connection failed -> end call" behavior
  // for the common 2-party case, without ending a group call over one bad
  // connection — the server remains authoritative either way).
  const handlePeerGone = useCallback(
    (username) => {
      const pc = pcMapRef.current.get(username);
      if (pc) {
        try {
          pc.close();
        } catch {
          /* ignore */
        }
      }
      pcMapRef.current.delete(username);

      const timer = connectTimersRef.current.get(username);
      if (timer) {
        clearTimeout(timer);
        connectTimersRef.current.delete(username);
      }
      pendingCandidatesRef.current.delete(username);

      setRemoteStreams((prev) => {
        if (!(username in prev)) return prev;
        const next = { ...prev };
        delete next[username];
        return next;
      });

      const cs = callStateRef.current;
      const otherJoined = Object.entries(cs.participants || {}).filter(
        ([u, p]) => u !== me && u !== username && p.status === "joined",
      );
      if (otherJoined.length === 0 && cs.callId) {
        socket.emit("call:leave", { callId: cs.callId });
        resetToIdle("callConnectFailed");
      }
    },
    [me, resetToIdle],
  );

  const createPeerConnectionFor = useCallback(
    (username) => {
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

      pc.onicecandidate = (e) => {
        if (e.candidate) {
          socket.emit("call:ice-candidate", {
            callId: callStateRef.current.callId,
            to: username,
            candidate: e.candidate,
          });
        }
      };

      pc.ontrack = (e) => {
        setRemoteStreams((prev) => ({ ...prev, [username]: e.streams[0] }));
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "connected") {
          const timer = connectTimersRef.current.get(username);
          if (timer) {
            clearTimeout(timer);
            connectTimersRef.current.delete(username);
          }
          setCallState((s) =>
            s.status !== "active"
              ? { ...s, status: "active", startedAt: s.startedAt || Date.now() }
              : s,
          );
        } else if (
          pc.connectionState === "failed" ||
          pc.connectionState === "closed"
        ) {
          if (pcMapRef.current.get(username) === pc) handlePeerGone(username);
        }
      };

      pc.oniceconnectionstatechange = () => {
        if (pc.iceConnectionState === "failed") {
          try {
            pc.restartIce();
          } catch {
            /* not supported, timeout below will surface the error */
          }
        }
      };

      pcMapRef.current.set(username, pc);

      const timer = setTimeout(() => {
        if (
          pcMapRef.current.get(username) === pc &&
          pc.connectionState !== "connected"
        ) {
          handlePeerGone(username);
        }
      }, CONNECT_TIMEOUT_MS);
      connectTimersRef.current.set(username, timer);

      return pc;
    },
    [handlePeerGone],
  );

  // Attaches local tracks to a pc, plus: if this device has no camera
  // (audio-only fallback) but the call is a video call, still offer to
  // receive that peer's video so their camera feed shows up on our side.
  // Must run for every pc regardless of offerer/answerer role, since under
  // group orchestration either side can end up creating the offer.
  const attachLocalTracksWithFallback = useCallback((pc) => {
    const stream = localStreamRef.current;
    if (!stream) return;
    stream.getTracks().forEach((track) => pc.addTrack(track, stream));
    if (
      callStateRef.current.callType === "video" &&
      stream.getVideoTracks().length === 0
    ) {
      try {
        pc.addTransceiver("video", { direction: "recvonly" });
      } catch {
        /* ignore */
      }
    }
  }, []);

  const flushPendingCandidates = useCallback(async (username) => {
    const pc = pcMapRef.current.get(username);
    if (!pc) return;
    const queue = pendingCandidatesRef.current.get(username) || [];
    pendingCandidatesRef.current.delete(username);
    for (const c of queue) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(c));
      } catch {
        /* ignore */
      }
    }
  }, []);

  const refreshCanSwitchCamera = useCallback(async (hasVideo) => {
    if (!hasVideo || !navigator.mediaDevices?.enumerateDevices) {
      setCanSwitchCamera(false);
      return;
    }
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const cams = devices.filter((d) => d.kind === "videoinput");
      setCanSwitchCamera(cams.length > 1);
    } catch {
      setCanSwitchCamera(false);
    }
  }, []);

  const startCall = useCallback(
    async (room, type) => {
      if (!room || callStateRef.current.status !== "idle") return;

      let videoFallback = false;
      try {
        const { stream, videoFallback: fb } = await acquireLocalMedia(
          type === "video",
        );
        videoFallback = fb;
        localStreamRef.current = stream;
        setLocalStream(stream);
        refreshCanSwitchCamera(stream.getVideoTracks().length > 0);
      } catch {
        resetToIdle("micDenied");
        return;
      }

      setCallState({
        status: "calling",
        callId: null,
        callType: type,
        isStarter: true,
        starter: me,
        participants: {},
        error: videoFallback ? "noCameraAudioOnly" : null,
        startedAt: null,
      });
      socket.emit("call:start", { room, callType: type });
    },
    [me, resetToIdle, refreshCanSwitchCamera],
  );

  const acceptCall = useCallback(async () => {
    const cs = callStateRef.current;
    if (cs.status !== "ringing" || !cs.callId) return;

    try {
      const { stream, videoFallback } = await acquireLocalMedia(
        cs.callType === "video",
      );
      localStreamRef.current = stream;
      setLocalStream(stream);
      refreshCanSwitchCamera(stream.getVideoTracks().length > 0);

      setCallState((s) => ({
        ...s,
        status: "connecting",
        error: videoFallback ? "noCameraAudioOnly" : s.error,
      }));
      socket.emit("call:join", { callId: cs.callId });
    } catch {
      socket.emit("call:decline", { callId: cs.callId });
      resetToIdle("micDenied");
    }
  }, [resetToIdle, refreshCanSwitchCamera]);

  const rejectCall = useCallback(() => {
    const cs = callStateRef.current;
    if (cs.status !== "ringing" || !cs.callId) return;
    socket.emit("call:decline", { callId: cs.callId });
    resetToIdle(null);
  }, [resetToIdle]);

  const endCall = useCallback(() => {
    const cs = callStateRef.current;
    if (cs.callId) socket.emit("call:leave", { callId: cs.callId });
    resetToIdle(null);
  }, [resetToIdle]);

  const toggleMute = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const next = !muted;
    stream.getAudioTracks().forEach((tr) => (tr.enabled = !next));
    setMuted(next);
  }, [muted]);

  const toggleCamera = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const videoTracks = stream.getVideoTracks();
    if (!videoTracks.length) return;
    const next = !cameraOff;
    videoTracks.forEach((tr) => (tr.enabled = !next));
    setCameraOff(next);
  }, [cameraOff]);

  const switchCamera = useCallback(async () => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const currentTrack = stream.getVideoTracks()[0];
    if (!currentTrack) return;

    const currentFacing =
      currentTrack.getSettings?.().facingMode || facingModeRef.current;
    const nextFacing = currentFacing === "environment" ? "user" : "environment";

    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { exact: nextFacing } },
      });
      const newTrack = newStream.getVideoTracks()[0];
      if (!newTrack) return;

      for (const pc of pcMapRef.current.values()) {
        const sender = pc
          .getSenders()
          .find((s) => s.track && s.track.kind === "video");
        if (sender) await sender.replaceTrack(newTrack);
      }

      const wasEnabled = currentTrack.enabled;
      currentTrack.stop();
      stream.removeTrack(currentTrack);
      newTrack.enabled = wasEnabled;
      stream.addTrack(newTrack);
      facingModeRef.current = nextFacing;
      setFacingMode(nextFacing);
      setLocalStream(new MediaStream(stream.getTracks()));
    } catch {
      /* device doesn't support the requested facing mode — keep current camera */
    }
  }, []);

  useEffect(() => {
    const onRing = ({ callId, callType, from, participants }) => {
      const cs = callStateRef.current;
      if (cs.status !== "idle" && cs.callId !== callId) {
        // Already in a different call — auto-decline, mirrors the old
        // "busy" behavior.
        socket.emit("call:decline", { callId });
        return;
      }
      if (cs.status === "idle") {
        setCallState({
          status: "ringing",
          callId,
          callType: callType === "video" ? "video" : "audio",
          isStarter: false,
          starter: from,
          participants: snapshotToObject(participants),
          error: null,
          startedAt: null,
        });
      } else {
        // Reconnect resume for a call already tracked — just refresh the roster.
        setCallState((s) => ({ ...s, participants: snapshotToObject(participants) }));
      }
    };

    const onStarted = ({ callId, callType, participants }) => {
      hasJoinedRef.current = true;
      setCallState((s) => ({
        ...s,
        status: "calling",
        callId,
        callType: callType === "video" ? "video" : "audio",
        participants: snapshotToObject(participants),
      }));
    };

    const onParticipantJoined = async ({ callId, username, participants }) => {
      if (callStateRef.current.callId !== callId) return;
      setCallState((s) => ({ ...s, participants: snapshotToObject(participants) }));

      if (username === me) {
        hasJoinedRef.current = true;
        setCallState((s) => (s.status === "active" ? s : { ...s, status: "connecting" }));
        return;
      }

      // Existing-member-offers-to-newcomer rule: only already-joined
      // clients proactively create an offer.
      if (hasJoinedRef.current && localStreamRef.current) {
        const pc = createPeerConnectionFor(username);
        attachLocalTracksWithFallback(pc);
        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          socket.emit("call:offer", { callId, to: username, offer });
        } catch {
          /* connect-timeout will surface if this peer never connects */
        }
      }
    };

    const onOffer = async ({ callId, from, offer }) => {
      if (callStateRef.current.callId !== callId) return;
      let pc = pcMapRef.current.get(from);
      if (!pc) {
        pc = createPeerConnectionFor(from);
        attachLocalTracksWithFallback(pc);
      }
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      await flushPendingCandidates(from);

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit("call:answer", { callId, to: from, answer });
    };

    const onAnswer = async ({ callId, from, answer }) => {
      if (callStateRef.current.callId !== callId) return;
      const pc = pcMapRef.current.get(from);
      if (!pc) return;
      await pc.setRemoteDescription(new RTCSessionDescription(answer));
      await flushPendingCandidates(from);
    };

    const onIceCandidate = async ({ callId, from, candidate }) => {
      if (callStateRef.current.callId !== callId) return;
      const pc = pcMapRef.current.get(from);
      if (!pc || !pc.remoteDescription) {
        const q = pendingCandidatesRef.current.get(from) || [];
        q.push(candidate);
        pendingCandidatesRef.current.set(from, q);
        return;
      }
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch {
        /* ignore */
      }
    };

    const onParticipantDeclined = ({ callId, participants }) => {
      if (callStateRef.current.callId !== callId) return;
      setCallState((s) => ({ ...s, participants: snapshotToObject(participants) }));
    };

    const onParticipantLeft = ({ callId, username, participants }) => {
      if (callStateRef.current.callId !== callId) return;
      setCallState((s) => ({ ...s, participants: snapshotToObject(participants) }));

      const pc = pcMapRef.current.get(username);
      if (pc) {
        try {
          pc.close();
        } catch {
          /* ignore */
        }
        pcMapRef.current.delete(username);
      }
      const timer = connectTimersRef.current.get(username);
      if (timer) {
        clearTimeout(timer);
        connectTimersRef.current.delete(username);
      }
      pendingCandidatesRef.current.delete(username);
      setRemoteStreams((prev) => {
        if (!(username in prev)) return prev;
        const next = { ...prev };
        delete next[username];
        return next;
      });
    };

    const onCallFull = ({ callId }) => {
      if (callStateRef.current.callId !== callId) return;
      resetToIdle("callFull");
    };

    const onEnded = ({ callId }) => {
      if (callStateRef.current.callId !== callId) return;
      resetToIdle(null);
    };

    socket.on("call:ring", onRing);
    socket.on("call:started", onStarted);
    socket.on("call:participant-joined", onParticipantJoined);
    socket.on("call:offer", onOffer);
    socket.on("call:answer", onAnswer);
    socket.on("call:ice-candidate", onIceCandidate);
    socket.on("call:participant-declined", onParticipantDeclined);
    socket.on("call:participant-left", onParticipantLeft);
    socket.on("call:full", onCallFull);
    socket.on("call:ended", onEnded);

    return () => {
      socket.off("call:ring", onRing);
      socket.off("call:started", onStarted);
      socket.off("call:participant-joined", onParticipantJoined);
      socket.off("call:offer", onOffer);
      socket.off("call:answer", onAnswer);
      socket.off("call:ice-candidate", onIceCandidate);
      socket.off("call:participant-declined", onParticipantDeclined);
      socket.off("call:participant-left", onParticipantLeft);
      socket.off("call:full", onCallFull);
      socket.off("call:ended", onEnded);
    };
  }, [
    me,
    createPeerConnectionFor,
    attachLocalTracksWithFallback,
    flushPendingCandidates,
    resetToIdle,
  ]);

  // Ringtone for an incoming call, softer ringback for an outgoing one —
  // stops as soon as the call moves past ringing/calling either way.
  useEffect(() => {
    if (callState.status === "ringing" && !callState.isStarter) {
      startRingtone("incoming");
    } else if (callState.status === "calling" && callState.isStarter) {
      startRingtone("outgoing");
    } else {
      stopRingtone();
    }
    return () => stopRingtone();
  }, [callState.status, callState.isStarter]);

  // Keep the screen awake while a call is ringing/connecting/active.
  // Without this, mobile devices auto-lock mid-call, which suspends the
  // page (freezing the video) and often trips a socket disconnect shortly
  // after, ending the call as if the user had left.
  useEffect(() => {
    const shouldHold = ["ringing", "calling", "connecting", "active"].includes(
      callState.status,
    );
    if (!shouldHold || !("wakeLock" in navigator)) return undefined;

    let wakeLock = null;
    let released = false;

    const acquire = async () => {
      try {
        const lock = await navigator.wakeLock.request("screen");
        if (released) {
          lock.release().catch(() => {});
          return;
        }
        wakeLock = lock;
      } catch {
        /* not supported, or denied outside a user gesture — ignore */
      }
    };
    acquire();

    const onVisibility = () => {
      if (document.visibilityState === "visible" && !wakeLock) acquire();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      released = true;
      document.removeEventListener("visibilitychange", onVisibility);
      if (wakeLock) {
        wakeLock.release().catch(() => {});
        wakeLock = null;
      }
    };
  }, [callState.status]);

  useEffect(() => {
    return () => {
      const cs = callStateRef.current;
      if (cs.callId) socket.emit("call:leave", { callId: cs.callId });
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    callState,
    localStream,
    remoteStreams,
    muted,
    cameraOff,
    canSwitchCamera,
    facingMode,
    startCall,
    acceptCall,
    rejectCall,
    endCall,
    toggleMute,
    toggleCamera,
    switchCamera,
    clearError,
  };
}
