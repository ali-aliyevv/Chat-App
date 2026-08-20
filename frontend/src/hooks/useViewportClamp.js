import { useLayoutEffect } from "react";

// Keeps a floating panel (context menu, info popover, ...) fully on-screen —
// the raw tap/click coordinates it opens at can sit right against a phone's
// screen edge.
export function useViewportClamp(ref, position, setPosition, margin = 8) {
  useLayoutEffect(() => {
    if (!position) return;
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = Math.min(
      position.x,
      Math.max(margin, window.innerWidth - rect.width - margin),
    );
    const y = Math.min(
      position.y,
      Math.max(margin, window.innerHeight - rect.height - margin),
    );
    if (x !== position.x || y !== position.y) {
      setPosition((p) => (p ? { ...p, x, y } : p));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [position, margin]);
}
