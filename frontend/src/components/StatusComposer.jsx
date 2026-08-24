import { useEffect, useRef, useState } from "react";
import PropTypes from "prop-types";
import { useLanguage } from "../context/LanguageContext";
import "./StatusComposer.css";

const STATUS_BG_PRESETS = [
  "linear-gradient(135deg, #8fd9a8, #34a874 55%, #1e7f5c)",
  "linear-gradient(135deg, #ff8a80, #ff5252)",
  "linear-gradient(135deg, #64b5f6, #1e88e5)",
  "linear-gradient(135deg, #b39ddb, #7e57c2)",
  "linear-gradient(135deg, #ffd54f, #ffa000)",
  "linear-gradient(135deg, #37474f, #102027)",
];

export default function StatusComposer({ onClose, onCreateText, onCreateMedia }) {
  const { t } = useLanguage();
  const [mode, setMode] = useState("text");
  const [text, setText] = useState("");
  const [bgIndex, setBgIndex] = useState(0);
  const [file, setFile] = useState(null);
  const [isVideo, setIsVideo] = useState(false);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [caption, setCaption] = useState("");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const handleFilePick = (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setFile(f);
    setIsVideo(f.type.startsWith("video/"));
    setPreviewUrl(URL.createObjectURL(f));
    setMode("media");
    setError(null);
  };

  const handlePost = async () => {
    setError(null);
    if (mode === "text" && !text.trim()) return;
    if (mode === "media" && !file) return;

    setPosting(true);
    try {
      if (mode === "text") {
        await onCreateText(text.trim(), STATUS_BG_PRESETS[bgIndex]);
      } else {
        await onCreateMedia(file, caption.trim());
      }
      onClose();
    } catch {
      setError(t("uploadFailed"));
    } finally {
      setPosting(false);
    }
  };

  return (
    <div className="status-composer-overlay" onClick={onClose}>
      <div className="status-composer-panel" onClick={(e) => e.stopPropagation()}>
        <div className="status-composer-header">
          <button type="button" className="status-composer-close" onClick={onClose}>
            &times;
          </button>
          <div className="status-composer-tabs">
            <button
              type="button"
              className={`status-composer-tab ${mode === "text" ? "active" : ""}`}
              onClick={() => setMode("text")}
            >
              {t("statusTextOption")}
            </button>
            <button
              type="button"
              className={`status-composer-tab ${mode === "media" ? "active" : ""}`}
              onClick={() => fileInputRef.current?.click()}
            >
              {t("statusMediaOption")}
            </button>
          </div>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,video/*"
          hidden
          onChange={handleFilePick}
        />

        {mode === "text" ? (
          <div
            className="status-composer-text-preview"
            style={{ background: STATUS_BG_PRESETS[bgIndex] }}
          >
            <textarea
              className="status-composer-textarea"
              placeholder={t("statusTextPlaceholder")}
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={700}
              autoFocus
            />
          </div>
        ) : (
          <div className="status-composer-photo-preview">
            {previewUrl ? (
              isVideo ? (
                <video src={previewUrl} controls playsInline />
              ) : (
                <img src={previewUrl} alt="" />
              )
            ) : null}
            <input
              className="status-composer-caption"
              placeholder={t("statusCaptionPlaceholder")}
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
            />
          </div>
        )}

        {mode === "text" ? (
          <div className="status-composer-bg-swatches">
            {STATUS_BG_PRESETS.map((bg, i) => (
              <button
                key={bg}
                type="button"
                className={`status-composer-swatch ${i === bgIndex ? "active" : ""}`}
                style={{ background: bg }}
                onClick={() => setBgIndex(i)}
              />
            ))}
          </div>
        ) : null}

        {error ? <div className="status-composer-error">{error}</div> : null}

        <button
          type="button"
          className="status-composer-post"
          onClick={handlePost}
          disabled={posting || (mode === "text" ? !text.trim() : !file)}
        >
          {posting ? t("sending") : t("postStatus")}
        </button>
      </div>
    </div>
  );
}

StatusComposer.propTypes = {
  onClose: PropTypes.func.isRequired,
  onCreateText: PropTypes.func.isRequired,
  onCreateMedia: PropTypes.func.isRequired,
};
