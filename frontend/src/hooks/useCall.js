import { useCallback, useEffect, useRef, useState } from "react";
import { socket } from "../socket";

const ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

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

  const callStateRef = useRef(callState);
  const localStreamRef = useRef(null);
  const pcRef = useRef(null);
  const pendingCandidatesRef = useRef([]);

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
    if (pcRef.current) {
      pcRef.current.onicecandidate = null;
      pcRef.current.ontrack = null;
      pcRef.current.onconnectionstatechange = null;
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

  const createPeerConnection = useCallback((target) => {
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
        setCallState((s) =>
          s.status !== "active"
            ? { ...s, status: "active", startedAt: s.startedAt || Date.now() }
            : s,
        );
      }
    };

    pcRef.current = pc;
    return pc;
  }, []);

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

  const startCall = useCallback(
    async (target, type) => {
      if (!target || callStateRef.current.status !== "idle") return;

      try {
        const stream = await navigator.mediaDevices.getUserMedia(
          type === "video"
            ? { audio: true, video: true }
            : { audio: true, video: false },
        );
        localStreamRef.current = stream;
        setLocalStream(stream);
      } catch {
        resetToIdle("micDenied");
        return;
      }

      setCallState({
        status: "calling",
        callType: type,
        peer: target,
        isCaller: true,
        error: null,
        startedAt: null,
      });
      socket.emit("call:invite", { to: target, callType: type });
    },
    [resetToIdle],
  );

  const acceptCall = useCallback(async () => {
    const cs = callStateRef.current;
    if (cs.status !== "ringing" || !cs.peer) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia(
        cs.callType === "video"
          ? { audio: true, video: true }
          : { audio: true, video: false },
      );
      localStreamRef.current = stream;
      setLocalStream(stream);

      const pc = createPeerConnection(cs.peer);
      attachLocalTracks(pc, stream);

      setCallState((s) => ({ ...s, status: "connecting" }));
      socket.emit("call:accept", { to: cs.peer });
    } catch {
      socket.emit("call:reject", { to: cs.peer });
      resetToIdle("micDenied");
    }
  }, [createPeerConnection, attachLocalTracks, resetToIdle]);

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
    startCall,
    acceptCall,
    rejectCall,
    endCall,
    toggleMute,
    toggleCamera,
    clearError,
  };
}