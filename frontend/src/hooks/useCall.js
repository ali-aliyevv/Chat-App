import { useCallback, useEffect, useRef, useState } from "react";
import { socket } from "../socket";

const ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  // Public TURN relay (Open Relay Project) — required so calls can connect
  // when both peers are behind NAT/CGNAT (e.g. two phones on different
  // mobile networks), where STUN alone cannot establish connectivity.
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
    // instead of rejecting/ending it; the remote side can still send video.
    return {
      stream: await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      }),
      videoFallback: true,
    };
  }
}

const IDLE_STATE = {
  status: "idle",
  callType: "audio",
  peer: null,
  isCaller: false,
  error: null,
  startedAt: null,
};

export function useCall() {
  const [callState, setCallState] = useState(IDLE_STATE);
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);

  const [canSwitchCamera, setCanSwitchCamera] = useState(false);

  const callStateRef = useRef(callState);
  const localStreamRef = useRef(null);
  const pcRef = useRef(null);
  const pendingCandidatesRef = useRef([]);
  const connectTimerRef = useRef(null);
  const facingModeRef = useRef("user");

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
    if (connectTimerRef.current) {
      clearTimeout(connectTimerRef.current);
      connectTimerRef.current = null;
    }
    if (pcRef.current) {
      pcRef.current.onicecandidate = null;
      pcRef.current.ontrack = null;
      pcRef.current.onconnectionstatechange = null;
      pcRef.current.oniceconnectionstatechange = null;
      try {
        pcRef.current.close();
      } catch {
        /* ignore */
      }
      pcRef.current = null;
    }
    pendingCandidatesRef.current = [];
    stopLocalStream();
    setRemoteStream(null);
    setMuted(false);
    setCameraOff(false);
    setCanSwitchCamera(false);
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

  const createPeerConnection = useCallback(
    (target) => {
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

      pc.onicecandidate = (e) => {
        if (e.candidate) {
          socket.emit("call:ice-candidate", {
            to: target,
            candidate: e.candidate,
          });
        }
      };

      pc.ontrack = (e) => {
        setRemoteStream(e.streams[0]);
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "connected") {
          if (connectTimerRef.current) {
            clearTimeout(connectTimerRef.current);
            connectTimerRef.current = null;
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
          if (callStateRef.current.peer === target) {
            socket.emit("call:end", { to: target });
            resetToIdle("callConnectFailed");
          }
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

      pcRef.current = pc;

      // If ICE/DTLS never converges (typical when two peers are behind
      // NATs the TURN relay can't help with, or the network is down),
      // surface an error instead of hanging on "Connecting..." forever.
      connectTimerRef.current = setTimeout(() => {
        if (
          callStateRef.current.peer === target &&
          callStateRef.current.status !== "active"
        ) {
          socket.emit("call:end", { to: target });
          resetToIdle("callConnectFailed");
        }
      }, CONNECT_TIMEOUT_MS);

      return pc;
    },
    [resetToIdle],
  );

  const attachLocalTracks = useCallback((pc, stream) => {
    stream.getTracks().forEach((track) => pc.addTrack(track, stream));
  }, []);

  const flushPendingCandidates = useCallback(async () => {
    const pc = pcRef.current;
    if (!pc) return;
    const queued = pendingCandidatesRef.current;
    pendingCandidatesRef.current = [];
    for (const c of queued) {
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
    async (target, type) => {
      if (!target || callStateRef.current.status !== "idle") return;

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
        callType: type,
        peer: target,
        isCaller: true,
        error: videoFallback ? "noCameraAudioOnly" : null,
        startedAt: null,
      });
      socket.emit("call:invite", { to: target, callType: type });
    },
    [resetToIdle, refreshCanSwitchCamera],
  );

  const acceptCall = useCallback(async () => {
    const cs = callStateRef.current;
    if (cs.status !== "ringing" || !cs.peer) return;

    try {
      const { stream, videoFallback } = await acquireLocalMedia(
        cs.callType === "video",
      );
      localStreamRef.current = stream;
      setLocalStream(stream);
      refreshCanSwitchCamera(stream.getVideoTracks().length > 0);

      const pc = createPeerConnection(cs.peer);
      attachLocalTracks(pc, stream);

      setCallState((s) => ({
        ...s,
        status: "connecting",
        error: videoFallback ? "noCameraAudioOnly" : s.error,
      }));
      socket.emit("call:accept", { to: cs.peer });
    } catch {
      socket.emit("call:reject", { to: cs.peer });
      resetToIdle("micDenied");
    }
  }, [createPeerConnection, attachLocalTracks, resetToIdle, refreshCanSwitchCamera]);

  const rejectCall = useCallback(() => {
    const cs = callStateRef.current;
    if (cs.status !== "ringing" || !cs.peer) return;
    socket.emit("call:reject", { to: cs.peer });
    resetToIdle(null);
  }, [resetToIdle]);

  const endCall = useCallback(() => {
    const cs = callStateRef.current;
    if (cs.peer) socket.emit("call:end", { to: cs.peer });
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

      const pc = pcRef.current;
      const sender = pc
        ?.getSenders()
        .find((s) => s.track && s.track.kind === "video");
      if (sender) await sender.replaceTrack(newTrack);

      const wasEnabled = currentTrack.enabled;
      currentTrack.stop();
      stream.removeTrack(currentTrack);
      newTrack.enabled = wasEnabled;
      stream.addTrack(newTrack);
      facingModeRef.current = nextFacing;
      setLocalStream(new MediaStream(stream.getTracks()));
    } catch {
      /* device doesn't support the requested facing mode — keep current camera */
    }
  }, []);

  useEffect(() => {
    const onIncoming = ({ from, callType }) => {
      if (callStateRef.current.status !== "idle") {
        socket.emit("call:reject", { to: from });
        return;
      }
      setCallState({
        status: "ringing",
        callType: callType === "video" ? "video" : "audio",
        peer: from,
        isCaller: false,
        error: null,
        startedAt: null,
      });
    };

    const onAccepted = async ({ from }) => {
      const cs = callStateRef.current;
      if (cs.status !== "calling" || cs.peer !== from) return;

      const stream = localStreamRef.current;
      if (!stream) {
        resetToIdle("micDenied");
        return;
      }

      const pc = createPeerConnection(from);
      attachLocalTracks(pc, stream);

      // If this device has no camera (audio-only fallback) but the call
      // was started as a video call, still offer to receive the peer's
      // video so their camera feed shows up on our side.
      if (cs.callType === "video" && stream.getVideoTracks().length === 0) {
        try {
          pc.addTransceiver("video", { direction: "recvonly" });
        } catch {
          /* ignore */
        }
      }

      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        setCallState((s) => ({ ...s, status: "connecting" }));
        socket.emit("call:offer", { to: from, offer });
      } catch {
        socket.emit("call:end", { to: from });
        resetToIdle("micDenied");
      }
    };

    const onOffer = async ({ from, offer }) => {
      const pc = pcRef.current;
      if (!pc || callStateRef.current.peer !== from) return;
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      await flushPendingCandidates();

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit("call:answer", { to: from, answer });
    };

    const onAnswer = async ({ from, answer }) => {
      const pc = pcRef.current;
      if (!pc || callStateRef.current.peer !== from) return;
      await pc.setRemoteDescription(new RTCSessionDescription(answer));
      await flushPendingCandidates();
    };

    const onIceCandidate = async ({ from, candidate }) => {
      if (callStateRef.current.peer !== from) return;
      const pc = pcRef.current;
      if (!pc || !pc.remoteDescription) {
        pendingCandidatesRef.current.push(candidate);
        return;
      }
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch {
        /* ignore */
      }
    };

    const onRejected = ({ from }) => {
      if (callStateRef.current.peer !== from) return;
      resetToIdle("callRejected");
    };

    const onUnavailable = ({ to }) => {
      if (callStateRef.current.peer !== to) return;
      resetToIdle("callUnavailable");
    };

    const onBusy = ({ to }) => {
      if (callStateRef.current.peer !== to) return;
      resetToIdle("callBusy");
    };

    const onEnded = ({ from }) => {
      if (callStateRef.current.peer !== from) return;
      resetToIdle(null);
    };

    socket.on("call:incoming", onIncoming);
    socket.on("call:accepted", onAccepted);
    socket.on("call:offer", onOffer);
    socket.on("call:answer", onAnswer);
    socket.on("call:ice-candidate", onIceCandidate);
    socket.on("call:rejected", onRejected);
    socket.on("call:unavailable", onUnavailable);
    socket.on("call:busy", onBusy);
    socket.on("call:ended", onEnded);

    return () => {
      socket.off("call:incoming", onIncoming);
      socket.off("call:accepted", onAccepted);
      socket.off("call:offer", onOffer);
      socket.off("call:answer", onAnswer);
      socket.off("call:ice-candidate", onIceCandidate);
      socket.off("call:rejected", onRejected);
      socket.off("call:unavailable", onUnavailable);
      socket.off("call:busy", onBusy);
      socket.off("call:ended", onEnded);
    };
  }, [
    createPeerConnection,
    attachLocalTracks,
    flushPendingCandidates,
    resetToIdle,
  ]);

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
      if (cs.peer) socket.emit("call:end", { to: cs.peer });
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    callState,
    localStream,
    remoteStream,
    muted,
    cameraOff,
    canSwitchCamera,
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