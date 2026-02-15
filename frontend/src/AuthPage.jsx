import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import PropTypes from "prop-types";
import { api } from "./api";
import { useLanguage } from "./context/LanguageContext";
import SettingsBar from "./components/SettingsBar";
import "./style/AuthPage.css";

const QRCodeCanvas = lazy(() =>
  import("qrcode.react").then((mod) => ({ default: mod.QRCodeCanvas }))
);

const OTP_TTL_SEC = 5 * 60;
const RESEND_COOLDOWN_SEC = 60;

const formatMMSS = (sec) => {
  const m = String(Math.floor(sec / 60)).padStart(2, "0");
  const s = String(sec % 60).padStart(2, "0");
  return `${m}:${s}`;
};

const AuthPage = ({ onAuthed, pendingRoom }) => {
  const { t } = useLanguage();

  const [mode, setMode] = useState("login");

  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");

  const [email, setEmail] = useState("");
  const [regUsername, setRegUsername] = useState("");
  const [regPassword, setRegPassword] = useState("");

  const [otpStep, setOtpStep] = useState(false);
  const [otpCode, setOtpCode] = useState("");

  const [otpLeft, setOtpLeft] = useState(OTP_TTL_SEC);
  const [resendLeft, setResendLeft] = useState(0);

  const [room, setRoom] = useState("general");

  const [err, setErr] = useState("");
  const [info, setInfo] = useState("");
  const [loading, setLoading] = useState(false);

  const [inviteRoom, setInviteRoom] = useState("");
  const [inviteUrl, setInviteUrl] = useState("");
  const [inviteErr, setInviteErr] = useState("");

  const isLogin = mode === "login";

  const title = useMemo(() => (isLogin ? t("login") : t("register")), [isLogin, t]);
  const subtitle = useMemo(
    () => (isLogin ? t("loginSubtitle") : t("registerSubtitle")),
    [isLogin, t]
  );

  useEffect(() => {
    if (pendingRoom) setRoom(pendingRoom);
  }, [pendingRoom]);

  const resetMsgs = () => {
    setErr("");
    setInfo("");
  };

  const goToLogin = () => {
    setMode("login");
    setOtpStep(false);
    setOtpCode("");
    setOtpLeft(OTP_TTL_SEC);
    setResendLeft(0);
    resetMsgs();
  };

  const goToRegister = () => {
    setMode("register");
    setOtpStep(false);
    setOtpCode("");
    setOtpLeft(OTP_TTL_SEC);
    setResendLeft(0);
    resetMsgs();
  };

  useEffect(() => {
    if (!otpStep) return;

    setOtpLeft(OTP_TTL_SEC);
    setResendLeft(RESEND_COOLDOWN_SEC);

    const timer = setInterval(() => {
      setOtpLeft((v) => (v > 0 ? v - 1 : 0));
      setResendLeft((v) => (v > 0 ? v - 1 : 0));
    }, 1000);

    return () => clearInterval(timer);
  }, [otpStep]);

  const requestOtp = async (e) => {
    if (e?.preventDefault) e.preventDefault();
    if (loading) return;

    resetMsgs();
    setLoading(true);

    try {
      const r = await api.post("/api/register/request-otp", {
        email: email.trim(),
        username: regUsername.trim(),
        password: regPassword,
      });

      setOtpStep(true);

      const sec = r.data?.expiresInSec ?? OTP_TTL_SEC;
      setOtpLeft(sec);
      setResendLeft(RESEND_COOLDOWN_SEC);
    } catch (e2) {
      setErr(e2.response?.data?.message || e2.message);
    } finally {
      setLoading(false);
    }
  };

  const verifyOtp = async (e) => {
    e.preventDefault();
    if (loading) return;

    resetMsgs();

    const clean = otpCode.replace(/\D/g, "").slice(0, 6);
    if (clean.length !== 6) {
      setErr(t("otpMustBe6"));
      return;
    }

    setLoading(true);

    try {
      const r = await api.post("/api/register/verify-otp", {
        email: email.trim(),
        code: clean,
      });

      onAuthed({ username: r.data.username, room: room.trim() || "general" });
    } catch (e2) {
      setErr(e2.response?.data?.message || e2.message);
    } finally {
      setLoading(false);
    }
  };

  const loginSubmit = async (e) => {
    e.preventDefault();
    if (loading) return;

    resetMsgs();
    setLoading(true);

    try {
      const r = await api.post("/api/login", {
        identifier: identifier.trim(),
        password,
      });

      onAuthed({ username: r.data.username, room: room.trim() || "general" });
    } catch (e2) {
      setErr(e2.response?.data?.message || e2.message);
    } finally {
      setLoading(false);
    }
  };

  const resendOtp = async () => {
    if (resendLeft > 0 || loading) return;
    await requestOtp();
    setInfo(t("codeSent"));
  };

  const generateRoom = async () => {
    if (loading) return;
    setInviteErr("");
    setInviteRoom("");
    setInviteUrl("");

    try {
      const r = await api.post("/api/rooms/create");
      const newRoom = String(r.data?.room || "").trim();
      const url = String(r.data?.inviteUrl || "").trim();

      setInviteRoom(newRoom);
      setInviteUrl(url);

      if (newRoom) setRoom(newRoom);
    } catch (e2) {
      setInviteErr(e2.response?.data?.message || e2.message || "Room create failed");
    }
  };

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-card-header">
          <div className="auth-card-header-left">
            <div className="auth-badge">REAL-TIME CHAT</div>
          </div>
          <SettingsBar compact />
        </div>

        <h1 className="auth-title">
          {title} <span className="wave">{'👋'}</span>
        </h1>
        <p className="auth-subtitle">{subtitle}</p>

        {isLogin && (
          <form onSubmit={loginSubmit} className="auth-form">
            <label className="auth-label">{t("emailOrUsername")}</label>
            <div className="auth-inputWrap">
              <span className="auth-icon">{'👤'}</span>
              <input
                className="auth-input"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder="ali123 / ali@gmail.com"
                autoComplete="username"
              />
            </div>

            <label className="auth-label" style={{ marginTop: 12 }}>
              {t("password")}
            </label>
            <div className="auth-inputWrap">
              <span className="auth-icon">{'🔒'}</span>
              <input
                className="auth-input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
              />
            </div>

            <label className="auth-label" style={{ marginTop: 12 }}>
              {t("room")}
            </label>
            <div className="auth-inputWrap">
              <span className="auth-icon">#</span>
              <input
                className="auth-input"
                value={room}
                onChange={(e) => setRoom(e.target.value)}
                placeholder="general"
                autoComplete="off"
              />
            </div>

            {err ? <div className="auth-msg auth-msg--err">{err}</div> : null}
            {info ? <div className="auth-msg auth-msg--info">{info}</div> : null}

            <button className="auth-primary" type="submit" disabled={loading}>
              {loading ? t("loading") : t("enter")}
              <span className="btn-glow" />
            </button>

            <div className="auth-divider">
              <span /> {t("or")} <span />
            </div>

            <button type="button" className="auth-secondary" onClick={goToRegister} disabled={loading}>
              {t("register")}
            </button>

            <div style={{ marginTop: 14 }}>
              <button
                type="button"
                className="auth-secondary"
                onClick={generateRoom}
                disabled={loading}
                style={{ width: "100%" }}
              >
                {t("generateRoom")}
              </button>

              {inviteErr ? <div className="auth-msg auth-msg--err">{inviteErr}</div> : null}

              {inviteUrl ? (
                <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
                  <div className="auth-msg auth-msg--info">
                    {t("inviteReady")}
                  </div>

                  <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
                    <div style={{ background: "white", padding: 10, borderRadius: 12 }}>
                      <Suspense fallback={<div style={{ width: 120, height: 120 }} />}>
                        <QRCodeCanvas value={inviteUrl} size={120} />
                      </Suspense>
                    </div>

                    <div style={{ display: "grid", gap: 8 }}>
                      <div><b>{t("room")}:</b> {inviteRoom}</div>

                      <a href={inviteUrl} target="_blank" rel="noreferrer">
                        {t("openInviteLink")}
                      </a>

                      <button
                        type="button"
                        className="auth-secondary"
                        onClick={() => navigator.clipboard?.writeText(inviteUrl)}
                      >
                        {t("copyLink")}
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </form>
        )}

        {!isLogin && !otpStep && (
          <form onSubmit={requestOtp} className="auth-form">
            <label className="auth-label">{t("email")}</label>
            <div className="auth-inputWrap">
              <span className="auth-icon">{'📧'}</span>
              <input
                className="auth-input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="example@gmail.com"
                type="email"
                autoComplete="email"
              />
            </div>

            <label className="auth-label" style={{ marginTop: 12 }}>
              {t("username")}
            </label>
            <div className="auth-inputWrap">
              <span className="auth-icon">{'👤'}</span>
              <input
                className="auth-input"
                value={regUsername}
                onChange={(e) => setRegUsername(e.target.value)}
                placeholder="ali123"
                autoComplete="nickname"
              />
            </div>

            <label className="auth-label" style={{ marginTop: 12 }}>
              {t("password")}
            </label>
            <div className="auth-inputWrap">
              <span className="auth-icon">{'🔒'}</span>
              <input
                className="auth-input"
                type="password"
                value={regPassword}
                onChange={(e) => setRegPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="new-password"
              />
            </div>

            <label className="auth-label" style={{ marginTop: 12 }}>
              {t("room")}
            </label>
            <div className="auth-inputWrap">
              <span className="auth-icon">#</span>
              <input
                className="auth-input"
                value={room}
                onChange={(e) => setRoom(e.target.value)}
                placeholder="general"
                autoComplete="off"
              />
            </div>

            {err ? <div className="auth-msg auth-msg--err">{err}</div> : null}
            {info ? <div className="auth-msg auth-msg--info">{info}</div> : null}

            <button className="auth-primary" type="submit" disabled={loading}>
              {loading ? t("sending") : t("sendCode")}
              <span className="btn-glow" />
            </button>

            <div className="auth-divider">
              <span /> {t("or")} <span />
            </div>

            <button type="button" className="auth-secondary" onClick={goToLogin} disabled={loading}>
              {t("backToLogin")}
            </button>
          </form>
        )}

        {!isLogin && otpStep && (
          <form onSubmit={verifyOtp} className="auth-form">
            <div className="auth-hint" style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
              <div>
                {t("otpHint")} <b>{email}</b>
              </div>
              <div style={{ opacity: 0.9 }}>
                {'⏳'} <b>{formatMMSS(otpLeft)}</b>
              </div>
            </div>

            <label className="auth-label">{t("otpCode")}</label>
            <div className="auth-inputWrap">
              <span className="auth-icon">{'🔢'}</span>
              <input
                className="auth-input"
                value={otpCode}
                onChange={(e) => {
                  const onlyDigits = e.target.value.replace(/\D/g, "").slice(0, 6);
                  setOtpCode(onlyDigits);
                }}
                placeholder="123456"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
              />
            </div>

            {otpLeft === 0 ? (
              <div className="auth-msg auth-msg--err">{t("otpExpired")}</div>
            ) : null}

            {err ? <div className="auth-msg auth-msg--err">{err}</div> : null}
            {info ? <div className="auth-msg auth-msg--info">{info}</div> : null}

            <button className="auth-primary" type="submit" disabled={loading || otpLeft === 0}>
              {loading ? t("verifying") : t("verify")}
              <span className="btn-glow" />
            </button>

            <button
              type="button"
              className="auth-secondary"
              style={{ marginTop: 12 }}
              onClick={() => {
                setOtpStep(false);
                setOtpCode("");
                setOtpLeft(OTP_TTL_SEC);
                setResendLeft(0);
                resetMsgs();
              }}
              disabled={loading}
            >
              {t("goBack")}
            </button>

            <button
              type="button"
              className="auth-secondary"
              style={{ marginTop: 10 }}
              onClick={resendOtp}
              disabled={loading || resendLeft > 0}
              title={resendLeft > 0 ? `${t("resendCode")} (${resendLeft}s)` : t("resendCode")}
            >
              {resendLeft > 0 ? `${t("resendCode")} (${resendLeft}s)` : t("resendCode")}
            </button>

            <button type="button" className="auth-secondary" style={{ marginTop: 10 }} onClick={goToLogin} disabled={loading}>
              {t("backToLogin")}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};

AuthPage.propTypes = {
  onAuthed: PropTypes.func.isRequired,
  pendingRoom: PropTypes.string,
};

export default AuthPage;
