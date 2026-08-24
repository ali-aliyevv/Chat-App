import { useRef, useState } from "react";
import PropTypes from "prop-types";
import { useLanguage } from "../context/LanguageContext";
import { api } from "../api";
import "./ProfileSettingsModal.css";

export default function ProfileSettingsModal({
  me,
  avatarUrl,
  about,
  onClose,
  onSaveProfile,
  onChangePassword,
}) {
  const { t } = useLanguage();
  const [localAvatar, setLocalAvatar] = useState(avatarUrl || "");
  const [localAbout, setLocalAbout] = useState(about || "");
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMsg, setProfileMsg] = useState(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const fileInputRef = useRef(null);

  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pwMsg, setPwMsg] = useState(null);
  const [pwError, setPwError] = useState(false);
  const [pwSaving, setPwSaving] = useState(false);

  const handleAvatarPick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setAvatarUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const uploadRes = await api.post("/api/upload", formData);
      const newUrl = uploadRes.data.url;
      await onSaveProfile({ avatarUrl: newUrl, about: localAbout });
      setLocalAvatar(newUrl);
      setProfileMsg(t("profileSaved"));
      setTimeout(() => setProfileMsg(null), 2500);
    } catch {
      /* upload failure — avatar simply stays unchanged */
    } finally {
      setAvatarUploading(false);
    }
  };

  const handleSaveAbout = async () => {
    setSavingProfile(true);
    try {
      await onSaveProfile({ avatarUrl: localAvatar, about: localAbout });
      setProfileMsg(t("profileSaved"));
      setTimeout(() => setProfileMsg(null), 2500);
    } finally {
      setSavingProfile(false);
    }
  };

  const handleChangePassword = async () => {
    setPwMsg(null);
    setPwError(false);
    if (newPassword.length < 6) {
      setPwMsg(t("passwordTooShort"));
      setPwError(true);
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwMsg(t("passwordMismatch"));
      setPwError(true);
      return;
    }
    setPwSaving(true);
    try {
      await onChangePassword(currentPassword, newPassword);
      setPwMsg(t("passwordChanged"));
      setPwError(false);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      setPwMsg(err?.response?.data?.message || t("passwordMismatch"));
      setPwError(true);
    } finally {
      setPwSaving(false);
    }
  };

  return (
    <div className="profile-modal-overlay" onClick={onClose}>
      <div className="profile-modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="profile-modal-header">
          <span>{t("profile")}</span>
          <button type="button" className="profile-modal-close" onClick={onClose}>
            &times;
          </button>
        </div>

        <div className="profile-modal-avatar-section">
          <div className="profile-modal-avatar">
            {localAvatar ? (
              <img src={localAvatar} alt="" />
            ) : (
              (me || "?").charAt(0).toUpperCase()
            )}
          </div>
          <button
            type="button"
            className="profile-modal-change-photo"
            onClick={() => fileInputRef.current?.click()}
            disabled={avatarUploading}
          >
            {avatarUploading ? t("uploading") : t("changePhoto")}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            hidden
            onChange={handleAvatarPick}
          />
        </div>

        <div className="profile-modal-field">
          <label>{t("about")}</label>
          <textarea
            value={localAbout}
            onChange={(e) => setLocalAbout(e.target.value)}
            maxLength={140}
            placeholder={t("aboutPlaceholder")}
          />
          <button
            type="button"
            className="profile-modal-save-btn"
            onClick={handleSaveAbout}
            disabled={savingProfile}
          >
            {t("save")}
          </button>
        </div>

        {profileMsg ? <div className="profile-modal-msg success">{profileMsg}</div> : null}

        <div className="profile-modal-divider" />

        <button
          type="button"
          className="profile-modal-toggle-pw"
          onClick={() => setShowPasswordForm((v) => !v)}
        >
          {t("changePassword")}
        </button>

        {showPasswordForm ? (
          <div className="profile-modal-pw-form">
            <input
              type="password"
              placeholder={t("currentPassword")}
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoComplete="current-password"
            />
            <input
              type="password"
              placeholder={t("newPassword")}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
            />
            <input
              type="password"
              placeholder={t("confirmNewPassword")}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
            />
            {pwMsg ? (
              <div className={`profile-modal-msg ${pwError ? "error" : "success"}`}>{pwMsg}</div>
            ) : null}
            <button
              type="button"
              className="profile-modal-save-btn"
              onClick={handleChangePassword}
              disabled={pwSaving || !currentPassword || !newPassword || !confirmPassword}
            >
              {t("save")}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

ProfileSettingsModal.propTypes = {
  me: PropTypes.string.isRequired,
  avatarUrl: PropTypes.string,
  about: PropTypes.string,
  onClose: PropTypes.func.isRequired,
  onSaveProfile: PropTypes.func.isRequired,
  onChangePassword: PropTypes.func.isRequired,
};
