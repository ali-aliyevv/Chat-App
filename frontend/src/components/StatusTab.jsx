import PropTypes from "prop-types";
import { useLanguage } from "../context/LanguageContext";
import "./StatusTab.css";

function Avatar({ username, avatarUrl }) {
  return (
    <div className="status-avatar">
      {avatarUrl ? (
        <img src={avatarUrl} alt="" />
      ) : (
        (username || "?").charAt(0).toUpperCase()
      )}
    </div>
  );
}

Avatar.propTypes = {
  username: PropTypes.string,
  avatarUrl: PropTypes.string,
};

export default function StatusTab({
  me,
  myAvatarUrl,
  mine,
  othersGrouped,
  onAddClick,
  onOpenViewer,
}) {
  const { t } = useLanguage();

  return (
    <div className="status-tab">
      <button
        type="button"
        className="status-row status-my-row"
        onClick={() =>
          mine.length > 0
            ? onOpenViewer({ username: me, avatarUrl: myAvatarUrl, items: mine })
            : onAddClick()
        }
      >
        <div className={`status-avatar-ring ${mine.length > 0 ? "has-status" : "no-status"}`}>
          <Avatar username={me} avatarUrl={myAvatarUrl} />
          <span
            className="status-add-badge"
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              onAddClick();
            }}
            title={t("addStatus")}
          >
            +
          </span>
        </div>
        <div className="status-row-text">
          <span className="status-row-name">{t("myStatus")}</span>
          <span className="status-row-sub">
            {mine.length > 0 ? t("statusExpiresIn") : t("addStatus")}
          </span>
        </div>
      </button>

      {othersGrouped.length > 0 ? (
        <div className="status-others-list">
          {othersGrouped.map((g) => (
            <button
              key={g.username}
              type="button"
              className="status-row"
              onClick={() => onOpenViewer(g)}
            >
              <div className={`status-avatar-ring ${g.hasUnviewed ? "unviewed" : "viewed"}`}>
                <Avatar username={g.username} avatarUrl={g.avatarUrl} />
              </div>
              <div className="status-row-text">
                <span className="status-row-name">{g.username}</span>
              </div>
            </button>
          ))}
        </div>
      ) : (
        <div className="status-empty">{t("noStatusUpdates")}</div>
      )}
    </div>
  );
}

StatusTab.propTypes = {
  me: PropTypes.string.isRequired,
  myAvatarUrl: PropTypes.string,
  mine: PropTypes.array.isRequired,
  othersGrouped: PropTypes.array.isRequired,
  onAddClick: PropTypes.func.isRequired,
  onOpenViewer: PropTypes.func.isRequired,
};
