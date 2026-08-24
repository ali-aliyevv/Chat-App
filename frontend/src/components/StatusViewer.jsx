import { useCallback, useEffect, useRef, useState } from "react";
import PropTypes from "prop-types";
import { useLanguage } from "../context/LanguageContext";
import "./StatusViewer.css";

const ITEM_DURATION_MS = 5000;
const CLOSE_DRAG_THRESHOLD = 90;
const PANEL_DRAG_THRESHOLD = 50;

const CloseIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
    <line x1="6" y1="6" x2="18" y2="18" />
    <line x1="18" y1="6" x2="6" y2="18" />
  </svg>
);

const EyeIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

const TrashIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6M14 11v6M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
  </svg>
);

const ChevronUpIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="18 15 12 9 6 15" />
  </svg>
);

export default function StatusViewer({ group, me, onClose, onView, onDelete, getViewers }) {
  const { t } = useLanguage();
  const [index, setIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const [paused, setPaused] = useState(false);
  const [showViewers, setShowViewers] = useState(false);
  const [viewers, setViewers] = useState([]);
  const [dragY, setDragY] = useState(0);
  const [closing, setClosing] = useState(false);
  const rafRef = useRef(null);
  const startRef = useRef(null);
  const elapsedRef = useRef(0);
  const videoRef = useRef(null);
  const dragRef = useRef(null);

  const isMine = group.username === me;
  const item = group.items[index];

  // Deleting an item can shrink the array out from under the currently
  // viewed index, or empty it entirely — keep both in bounds.
  useEffect(() => {
    if (group.items.length === 0) {
      onClose();
      return;
    }
    if (index >= group.items.length) setIndex(group.items.length - 1);
  }, [group.items.length, index, onClose]);

  const goNext = useCallback(() => {
    setIndex((i) => (i < group.items.length - 1 ? i + 1 : i));
    if (index >= group.items.length - 1) onClose();
  }, [index, group.items.length, onClose]);

  const goPrev = useCallback(() => {
    setIndex((i) => (i > 0 ? i - 1 : i));
  }, []);

  useEffect(() => {
    setProgress(0);
    elapsedRef.current = 0;
    setShowViewers(false);
  }, [index]);

  useEffect(() => {
    if (item && !item.viewed) onView(item.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id]);

  // Text/image items advance on a fixed timer; video items advance when the
  // video itself ends, with progress driven by actual playback below.
  useEffect(() => {
    if (paused || showViewers || !item || item.type === "video") return undefined;
    startRef.current = performance.now() - elapsedRef.current;
    const tick = (now) => {
      const elapsed = now - startRef.current;
      elapsedRef.current = elapsed;
      const pct = Math.min(1, elapsed / ITEM_DURATION_MS);
      setProgress(pct);
      if (pct >= 1) {
        goNext();
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [paused, showViewers, index, item, goNext]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v || !item || item.type !== "video") return;
    if (paused || showViewers) v.pause();
    else v.play().catch(() => {});
  }, [paused, showViewers, item]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") goNext();
      if (e.key === "ArrowLeft") goPrev();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, goNext, goPrev]);

  const loadViewers = useCallback(async () => {
    setShowViewers(true);
    setPaused(true);
    try {
      const list = await getViewers(item.id);
      setViewers(list);
    } catch {
      setViewers([]);
    }
  }, [getViewers, item?.id]);

  const closeViewersPanel = () => {
    setShowViewers(false);
    setPaused(false);
  };

  const handleDelete = () => {
    if (!window.confirm(t("deleteStatusConfirm"))) return;
    onDelete(item.id);
  };

  // Vertical swipe handling on the stage: swipe down closes the viewer
  // (WhatsApp-style, with a live drag-to-dismiss transform), swipe up on
  // your own status reveals the seen-by/delete panel.
  const onStagePointerDown = (e) => {
    dragRef.current = { startX: e.clientX, startY: e.clientY, dragging: false, direction: null };
    setPaused(true);
  };

  const onStagePointerMove = (e) => {
    const ds = dragRef.current;
    if (!ds) return;
    const dx = e.clientX - ds.startX;
    const dy = e.clientY - ds.startY;
    if (!ds.dragging && Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) {
      ds.dragging = true;
      ds.direction = dy > 0 ? "down" : "up";
    }
    if (ds.dragging && ds.direction === "down") {
      setDragY(Math.max(0, dy));
    }
  };

  const onStagePointerUp = (e) => {
    const ds = dragRef.current;
    dragRef.current = null;
    if (!ds) return;

    if (ds.dragging && ds.direction === "down") {
      const dy = e.clientY - ds.startY;
      if (dy > CLOSE_DRAG_THRESHOLD) {
        setClosing(true);
        setTimeout(onClose, 150);
        return;
      }
      setDragY(0);
      setPaused(false);
      return;
    }

    if (ds.dragging && ds.direction === "up" && isMine) {
      const dy = e.clientY - ds.startY;
      if (Math.abs(dy) > PANEL_DRAG_THRESHOLD) {
        loadViewers();
        return;
      }
    }

    setPaused(false);
  };

  if (!item) return null;

  return (
    <div
      className={`status-viewer-overlay ${closing ? "closing" : ""}`}
      style={dragY ? { transform: `translateY(${dragY}px)`, opacity: Math.max(0.35, 1 - dragY / 400) } : undefined}
    >
      <div className="status-viewer-progress-row">
        {group.items.map((it, i) => (
          <div key={it.id} className="status-viewer-progress-track">
            <div
              className="status-viewer-progress-fill"
              style={{
                width: i < index ? "100%" : i === index ? `${progress * 100}%` : "0%",
              }}
            />
          </div>
        ))}
      </div>

      <div className="status-viewer-header">
        <div className="status-viewer-avatar">
          {group.avatarUrl ? (
            <img src={group.avatarUrl} alt="" />
          ) : (
            group.username.charAt(0).toUpperCase()
          )}
        </div>
        <span className="status-viewer-username">
          {isMine ? t("myStatus") : group.username}
        </span>
        <button type="button" className="status-viewer-close" onClick={onClose} title={t("close")}>
          <CloseIcon />
        </button>
      </div>

      <div
        className="status-viewer-stage"
        onPointerDown={onStagePointerDown}
        onPointerMove={onStagePointerMove}
        onPointerUp={onStagePointerUp}
        onPointerCancel={onStagePointerUp}
      >
        <div className="status-viewer-tap-zone left" onClick={goPrev} />
        <div className="status-viewer-tap-zone right" onClick={goNext} />

        {item.type === "image" ? (
          <img className="status-viewer-media" src={item.mediaUrl} alt="" />
        ) : item.type === "video" ? (
          <video
            ref={videoRef}
            className="status-viewer-media"
            src={item.mediaUrl}
            autoPlay
            playsInline
            onLoadedMetadata={(e) => {
              elapsedRef.current = 0;
              setProgress(0);
              e.currentTarget.play().catch(() => {});
            }}
            onTimeUpdate={(e) => {
              const v = e.currentTarget;
              if (v.duration) setProgress(v.currentTime / v.duration);
            }}
            onEnded={goNext}
          />
        ) : (
          <div
            className="status-viewer-text-slide"
            style={item.bgColor ? { background: item.bgColor } : undefined}
          >
            <p>{item.text}</p>
          </div>
        )}
        {item.type !== "text" && item.text ? (
          <div className="status-viewer-caption">{item.text}</div>
        ) : null}
      </div>

      {isMine ? (
        <button type="button" className="status-viewer-handle" onClick={loadViewers}>
          <ChevronUpIcon />
          <EyeIcon />
          {t("seenBy")}
        </button>
      ) : null}

      {showViewers ? (
        <div className="status-viewer-viewers-panel" onClick={closeViewersPanel}>
          <div className="status-viewer-viewers-list" onClick={(e) => e.stopPropagation()}>
            <div className="status-viewer-viewers-drag-bar" />
            <div className="status-viewer-viewers-header">
              <span className="status-viewer-viewers-title">{t("seenBy")}</span>
              <button type="button" className="status-viewer-trash-btn" onClick={handleDelete} title={t("deleteStatus")}>
                <TrashIcon />
              </button>
            </div>
            {viewers.length === 0 ? (
              <div className="status-viewer-no-views">{t("noViewsYet")}</div>
            ) : (
              viewers.map((v) => (
                <div key={v.username} className="status-viewer-viewer-row">
                  <div className="status-viewer-viewer-avatar">
                    {v.avatarUrl ? (
                      <img src={v.avatarUrl} alt="" />
                    ) : (
                      v.username.charAt(0).toUpperCase()
                    )}
                  </div>
                  <span>{v.username}</span>
                </div>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

StatusViewer.propTypes = {
  group: PropTypes.shape({
    username: PropTypes.string.isRequired,
    avatarUrl: PropTypes.string,
    items: PropTypes.array.isRequired,
  }).isRequired,
  me: PropTypes.string.isRequired,
  onClose: PropTypes.func.isRequired,
  onView: PropTypes.func.isRequired,
  onDelete: PropTypes.func.isRequired,
  getViewers: PropTypes.func.isRequired,
};
