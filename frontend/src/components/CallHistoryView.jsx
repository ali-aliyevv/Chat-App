import PropTypes from "prop-types";
import { useLanguage } from "../context/LanguageContext";
import "../style/CallHistoryView.css";

const OutgoingIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="7" y1="17" x2="17" y2="7" />
    <polyline points="8 7 17 7 17 16" />
  </svg>
);

const IncomingIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="17" y1="7" x2="7" y2="17" />
    <polyline points="16 17 7 17 7 8" />
  </svg>
);

const AudioTypeIcon = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor">
    <path d="M6.62 10.79a15.05 15.05 0 0 0 6.59 6.59l2.2-2.2a1 1 0 0 1 1.02-.24c1.12.37 2.33.57 3.57.57a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1C10.61 21 3 13.39 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.24.2 2.45.57 3.57a1 1 0 0 1-.24 1.02l-2.21 2.2z" />
  </svg>
);

const VideoTypeIcon = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="23 7 16 12 23 17 23 7" />
    <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
  </svg>
);

const GroupIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);

function formatDuration(sec) {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatWhen(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString([], { day: "2-digit", month: "2-digit" }) +
    " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function CallHistoryView({ callHistory, me, onCallBack }) {
  const { t } = useLanguage();

  return (
    <div className="call-history-view">
      {callHistory.length === 0 ? (
        <div className="call-history-empty">{t("callHistoryEmpty")}</div>
      ) : (
        <div className="call-history-list">
          {callHistory.map((row) => {
            const iAmStarter = row.starter === me;
            const others = (row.participants || []).filter((p) => p.username !== me);
            const isGroup = others.length > 1;
            const other = others[0];

            const wasConnected = row.status === "ended";
            const missed = !iAmStarter && !wasConnected;

            let label;
            if (wasConnected) {
              const joinedTimes = (row.participants || [])
                .map((p) => p.joinedAt)
                .filter(Boolean);
              const start = joinedTimes.length ? Math.min(...joinedTimes) : row.startedAt;
              const dur = row.endedAt ? (row.endedAt - start) / 1000 : 0;
              label = formatDuration(dur);
            } else if (!isGroup && other?.status === "declined") {
              label = t("callRejectedHistory");
            } else if (!isGroup && other?.status === "unavailable") {
              label = t("callUnavailableHistory");
            } else {
              label = iAmStarter ? t("noAnswerCall") : t("missedCall");
            }

            const title = isGroup
              ? t("groupCallLabel", { count: others.length + 1 })
              : other?.username || "?";

            return (
              <button
                key={row.id}
                type="button"
                className="call-history-row"
                onClick={() => onCallBack(row.callType)}
              >
                <div className="call-history-avatar">
                  {isGroup ? <GroupIcon /> : (other?.username || "?").charAt(0).toUpperCase()}
                </div>
                <div className="call-history-info">
                  <span className="call-history-peer">{title}</span>
                  <span className={`call-history-meta ${missed ? "missed" : ""}`}>
                    <span className={`call-history-direction ${missed ? "missed" : ""}`}>
                      {iAmStarter ? <OutgoingIcon /> : <IncomingIcon />}
                    </span>
                    {label}
                  </span>
                </div>
                <div className="call-history-right">
                  <span className="call-history-type-icon">
                    {row.callType === "video" ? <VideoTypeIcon /> : <AudioTypeIcon />}
                  </span>
                  <span className="call-history-time">{formatWhen(row.startedAt)}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

CallHistoryView.propTypes = {
  callHistory: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.string.isRequired,
      starter: PropTypes.string.isRequired,
      callType: PropTypes.string.isRequired,
      status: PropTypes.string.isRequired,
      startedAt: PropTypes.number,
      endedAt: PropTypes.number,
      participants: PropTypes.arrayOf(
        PropTypes.shape({
          username: PropTypes.string.isRequired,
          role: PropTypes.string,
          status: PropTypes.string,
          joinedAt: PropTypes.number,
          leftAt: PropTypes.number,
        }),
      ),
    }),
  ).isRequired,
  me: PropTypes.string.isRequired,
  onCallBack: PropTypes.func.isRequired,
};
