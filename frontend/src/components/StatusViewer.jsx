import { useCallback, useEffect, useRef, useState } from "react";
import PropTypes from "prop-types";
import { useLanguage } from "../context/LanguageContext";
import "./StatusViewer.css";

const ITEM_DURATION_MS = 5000;

export default function StatusViewer({ group, me, onClose, onView, onDelete, getViewers }) {
  const { t } = useLanguage();
  const [index, setIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const [paused, setPaused] = useState(false);
  const [showViewers, setShowViewers] = useState(false);
  const [viewers, setViewers] = useState([]);
  const rafRef = useRef(null);
  const startRef = useRef(null);
  const elapsedRef = useRef(0);

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

  useEffect(() => {
    if (paused || showViewers || !item) return undefined;
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
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") goNext();
      if (e.key === "ArrowLeft") goPrev();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, goNext, goPrev]);

  const loadViewers = async () => {
    setShowViewers(true);
    setPaused(true);
    try {
      const list = await getViewers(item.id);
      setViewers(list);
    } catch {
      setViewers([]);
    }
  };

  const closeViewersPanel = () => {
    setShowViewers(false);
    setPaused(false);
  };

  const handleDelete = () => {
    if (!window.confirm(t("deleteStatusConfirm"))) return;
    onDelete(item.id);
  };

  if (!item) return null;

  return (
    <div className="status-viewer-overlay">
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
        <button type="button" className="status-viewer-close" onClick={onClose}>
          &times;
        </button>
      </div>

      <div
        className="status-viewer-stage"
        onPointerDown={() => setPaused(true)}
        onPointerUp={() => setPaused(false)}
      >
        <div className="status-viewer-tap-zone left" onClick={goPrev} />
        <div className="status-viewer-tap-zone right" onClick={goNext} />

        {item.type === "image" ? (
          <img className="status-viewer-media" src={item.mediaUrl} alt="" />
        ) : (
          <div
            className="status-viewer-text-slide"
            style={item.bgColor ? { background: item.bgColor } : undefined}
          >
            <p>{item.text}</p>
          </div>
        )}
        {item.type === "image" && item.text ? (
          <div className="status-viewer-caption">{item.text}</div>
        ) : null}
      </div>

      {isMine ? (
        <div className="status-viewer-footer">
          <button type="button" className="status-viewer-seenby-btn" onClick={loadViewers}>
            {t("seenBy")}
          </button>
          <button type="button" className="status-viewer-delete-btn" onClick={handleDelete}>
            {t("deleteStatus")}
          </button>
        </div>
      ) : null}

      {showViewers ? (
        <div className="status-viewer-viewers-panel" onClick={closeViewersPanel}>
          <div className="status-viewer-viewers-list" onClick={(e) => e.stopPropagation()}>
            <div className="status-viewer-viewers-title">{t("seenBy")}</div>
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
