// iOS Safari's getUserMedia hands back an already horizontally-mirrored
// raw frame for the front camera (unlike desktop Chrome/Firefox and
// Android Chrome, which deliver a natural, non-mirrored frame). CSS can
// only ever affect how a stream is *displayed* locally — it never touches
// the actual pixels handed to MediaRecorder or a peer connection — so on
// iOS the recorded/sent video comes out mirrored unless the frames
// themselves are counter-flipped before they leave the device.
export function isIOSDevice() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  if (/iPad|iPhone|iPod/.test(ua) && !window.MSStream) return true;
  // iPadOS 13+ reports as "MacIntel" but exposes touch support, unlike a
  // real Mac.
  return navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
}

// Draws the given stream's video track onto a canvas every frame with a
// horizontal flip, returning a new MediaStream (canvas video + original
// audio) plus a cleanup() to stop the draw loop. Only meant to be used to
// counter iOS's mirrored front camera — call isIOSDevice() first.
export function createCounterMirroredStream(rawStream) {
  const videoTrack = rawStream.getVideoTracks()[0];
  if (!videoTrack) return { stream: rawStream, cleanup: () => {} };

  const { width, height } = videoTrack.getSettings();
  const w = width || 640;
  const h = height || 480;

  const sourceVideo = document.createElement("video");
  sourceVideo.srcObject = new MediaStream([videoTrack]);
  sourceVideo.muted = true;
  sourceVideo.playsInline = true;
  sourceVideo.play().catch(() => {});

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");

  let rafId = null;
  const draw = () => {
    if (sourceVideo.readyState >= 2) {
      ctx.save();
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(sourceVideo, 0, 0, canvas.width, canvas.height);
      ctx.restore();
    }
    rafId = requestAnimationFrame(draw);
  };
  rafId = requestAnimationFrame(draw);

  const canvasStream = canvas.captureStream(30);
  rawStream.getAudioTracks().forEach((track) => canvasStream.addTrack(track));

  return {
    stream: canvasStream,
    cleanup: () => {
      if (rafId) cancelAnimationFrame(rafId);
      sourceVideo.srcObject = null;
    },
  };
}
