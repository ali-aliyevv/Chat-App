// Synthesized call tones (Web Audio API) — no bundled audio asset needed.
// `incoming` mirrors a classic phone ring pattern (short double-beep,
// pause, repeat); `outgoing` is a softer, slower single-tone ringback for
// the caller while waiting, matching how WhatsApp sounds on either side
// of a call.

let audioCtx = null;
let timerId = null;
let activeKind = null;

function getContext() {
  if (audioCtx && audioCtx.state !== "closed") return audioCtx;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  audioCtx = new Ctx();
  return audioCtx;
}

function beep(ctx, { freq, start, duration, gain = 0.18 }) {
  const osc = ctx.createOscillator();
  const gainNode = ctx.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  gainNode.gain.setValueAtTime(0, start);
  gainNode.gain.linearRampToValueAtTime(gain, start + 0.02);
  gainNode.gain.setValueAtTime(gain, start + duration - 0.03);
  gainNode.gain.linearRampToValueAtTime(0, start + duration);
  osc.connect(gainNode);
  gainNode.connect(ctx.destination);
  osc.start(start);
  osc.stop(start + duration);
}

function scheduleIncomingCycle(ctx, at) {
  // Two quick beeps, then a pause — repeated every 2s.
  beep(ctx, { freq: 900, start: at, duration: 0.32 });
  beep(ctx, { freq: 900, start: at + 0.42, duration: 0.32 });
}

function scheduleOutgoingCycle(ctx, at) {
  // A single soft ringback tone every ~3s.
  beep(ctx, { freq: 440, start: at, duration: 1.0, gain: 0.1 });
}

export function startRingtone(kind) {
  if (activeKind === kind) return;
  stopRingtone();

  const ctx = getContext();
  if (!ctx) return;
  if (ctx.state === "suspended") ctx.resume().catch(() => {});

  activeKind = kind;
  const scheduleCycle = kind === "outgoing" ? scheduleOutgoingCycle : scheduleIncomingCycle;
  const cycleMs = kind === "outgoing" ? 3000 : 2000;

  const tick = () => {
    try {
      scheduleCycle(ctx, ctx.currentTime + 0.05);
    } catch {
      /* context may have been closed mid-cycle — ignore */
    }
  };
  tick();
  timerId = setInterval(tick, cycleMs);
}

export function stopRingtone() {
  if (timerId) {
    clearInterval(timerId);
    timerId = null;
  }
  activeKind = null;
}
