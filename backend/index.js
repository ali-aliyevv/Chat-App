require("dotenv").config();

const path = require("path");
const fs = require("fs");
const express = require("express");
const http = require("http");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const { Server } = require("socket.io");
const { randomUUID } = require("crypto");
const webpush = require("web-push");

const { sendOtpEmail } = require("./mail");
const {
  createUser,
  findUserByEmail,
  findUserByUsername,
  findUserByIdentifier,
  findUserById,

  storeRefreshToken,
  revokeRefreshToken,
  revokeAllRefreshTokensForUser,
  getRefreshTokenRecord,
  deleteExpiredRefreshTokens,

  addMessage,
  getRecentMessages,
  getMessageById,
  getMessageByClientId,
  updateMessageText,
  softDeleteMessageForAll,
  deleteMessageForUser,
  getDeletedMessageIdsForUser,
  markReadForRoomExceptUser,
  markDeliveredForRoomExceptUser,

  createCallSession,
  addCallParticipant,
  markParticipantJoined,
  markParticipantStatus,
  markCallSessionStatus,
  getCallSessionById,
  getCallHistoryRowById,
  getCallHistoryForRoom,

  addSticker,
  getStickersForUser,
  deleteSticker,

  addPushSubscription,
  getPushSubscriptionsForUser,
  deletePushSubscriptionByEndpoint,

  updateUserProfile,
  updateUserPassword,

  addStatus,
  getActiveStatusesFeed,
  getStatusById,
  markStatusViewed,
  getStatusViewers,
  deleteStatus,
  deleteExpiredStatuses,

  upsertOtp,
  getOtp,
  deleteOtp,
  deleteExpiredOtps,
} = require("./db");

const app = express();
app.set("trust proxy", 1);
const server = http.createServer(app);

const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || "http://localhost:5173";
const ACCESS_SECRET = process.env.ACCESS_SECRET || "ACCESS_SECRET_CHANGE_ME";
const REFRESH_SECRET = process.env.REFRESH_SECRET || "REFRESH_SECRET_CHANGE_ME";

const INVITE_SECRET = process.env.INVITE_SECRET || "INVITE_SECRET_CHANGE_ME";
const INVITE_EXPIRES_IN = "10m";

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || "";
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || "";
if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    "mailto:support@realchat.app",
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY,
  );
} else {
  console.log(
    "⚠️  VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY not set — push notifications disabled",
  );
}

// ── Utility bot ──
// A free, rule-based "/command" bot (no paid AI API) — replies to a
// recognized slash-command with a normal chat message from a fixed bot
// identity. Weather uses Open-Meteo, which needs no API key.
const BOT_USERNAME = "🤖 Bot";

function safeArithmetic(expr) {
  if (!/^[0-9+\-*/().\s]+$/.test(expr)) return null;
  try {
    // eslint-disable-next-line no-new-func
    const result = Function(`"use strict"; return (${expr});`)();
    return typeof result === "number" && Number.isFinite(result) ? result : null;
  } catch {
    return null;
  }
}

async function fetchWeather(place) {
  const geoRes = await fetch(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(place)}&count=1&language=az`,
  );
  const geo = await geoRes.json();
  const hit = geo?.results?.[0];
  if (!hit) return null;

  const wRes = await fetch(
    `https://api.open-meteo.com/v1/forecast?latitude=${hit.latitude}&longitude=${hit.longitude}&current_weather=true`,
  );
  const w = await wRes.json();
  const cw = w?.current_weather;
  if (!cw) return null;
  return { name: hit.name, country: hit.country, temp: cw.temperature, wind: cw.windspeed };
}

const BOT_HELP_TEXT =
  "🤖 Əmrlər:\n" +
  "/vaxt — hazırkı vaxt\n" +
  "/tarix — bugünkü tarix\n" +
  "/hava <şəhər> — hava proqnozu\n" +
  "/zər — zər at\n" +
  "/sikkə — sikkə at\n" +
  "/hesabla <ifadə> — hesablama (məs. /hesabla 2+2*3)\n" +
  "/kömək — bu siyahı";

// Returns the bot's reply text, or null if `text` isn't a recognized
// command (so the caller knows not to post anything).
async function computeBotReply(text) {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return null;

  const [cmdRaw, ...rest] = trimmed.split(/\s+/);
  const cmd = cmdRaw.toLowerCase();
  const argStr = rest.join(" ").trim();

  switch (cmd) {
    case "/kömək":
    case "/komek":
    case "/help":
      return BOT_HELP_TEXT;

    case "/vaxt":
      return `🕒 Hazırkı vaxt: ${new Date().toLocaleTimeString("az-AZ", { hour: "2-digit", minute: "2-digit" })}`;

    case "/tarix":
      return `📅 Bugünkü tarix: ${new Date().toLocaleDateString("az-AZ")}`;

    case "/zər":
    case "/zar":
      return `🎲 ${1 + Math.floor(Math.random() * 6)}`;

    case "/sikkə":
    case "/sikke":
      return Math.random() < 0.5 ? "🪙 Yazı" : "🪙 Şəkil";

    case "/hesabla": {
      if (!argStr) return "İstifadə: /hesabla 2+2*3";
      const result = safeArithmetic(argStr);
      return result === null
        ? "Hesablaya bilmədim — yalnız ədəd və + - * / ( ) işarələrinə icazə verilir"
        : `🧮 ${argStr} = ${result}`;
    }

    case "/hava": {
      if (!argStr) return "İstifadə: /hava Bakı";
      try {
        const w = await fetchWeather(argStr);
        if (!w) return `"${argStr}" tapılmadı`;
        return `🌤️ ${w.name}${w.country ? ", " + w.country : ""}: ${w.temp}°C, külək ${w.wind} km/s`;
      } catch (e) {
        console.log("❌ Weather fetch error:", e?.message || e);
        return "Hava məlumatı alınmadı, bir az sonra yenidən cəhd edin";
      }
    }

    default:
      return null;
  }
}

async function sendPushToUser(username, payload) {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return;
  const subs = getPushSubscriptionsForUser(username);
  const body = JSON.stringify(payload);
  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          body,
        );
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) {
          deletePushSubscriptionByEndpoint(sub.endpoint);
        } else {
          console.log("❌ Push send error:", err?.message || err);
        }
      }
    }),
  );
}

const ACCESS_EXPIRES_IN = "15m";
const REFRESH_EXPIRES_IN = "7d";

const OTP_TTL_MS = 5 * 60 * 1000;
const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;

app.use(express.json());
app.use(cookieParser());

app.use(
  cors({
    origin: FRONTEND_ORIGIN,
    credentials: true,
  }),
);

const UPLOADS_DIR = path.join(__dirname, "uploads");
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

app.use("/uploads", express.static(UPLOADS_DIR));

// Best-effort delete of a file previously returned by /api/upload — only
// ever touches files that resolve inside UPLOADS_DIR.
function deleteUploadedFileFromUrl(url) {
  if (!url || typeof url !== "string") return;
  const filename = url.split("/uploads/")[1];
  if (!filename) return;
  const filePath = path.join(UPLOADS_DIR, path.basename(filename));
  if (!filePath.startsWith(UPLOADS_DIR)) return;
  fs.unlink(filePath, (err) => {
    if (err && err.code !== "ENOENT") {
      console.log("⚠️  Failed to delete uploaded file:", err.message);
    }
  });
}

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

const uploadStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).slice(0, 20);
    cb(null, `${Date.now()}_${randomUUID().slice(0, 8)}${ext}`);
  },
});

const upload = multer({
  storage: uploadStorage,
  limits: { fileSize: MAX_UPLOAD_BYTES },
});

function normalizeEmail(email) {
  return String(email || "")
    .trim()
    .toLowerCase();
}
function normalizeUsername(username) {
  return String(username || "").trim();
}
function isEmailLike(s) {
  return /.+@.+\..+/.test(String(s || "").trim());
}

function signAccess(user) {
  return jwt.sign({ sub: user.id, username: user.username }, ACCESS_SECRET, {
    expiresIn: ACCESS_EXPIRES_IN,
  });
}

function signRefresh(user) {
  return jwt.sign({ sub: user.id }, REFRESH_SECRET, {
    expiresIn: REFRESH_EXPIRES_IN,
  });
}

function signInvite(room) {
  return jwt.sign({ room }, INVITE_SECRET, { expiresIn: INVITE_EXPIRES_IN });
}

function cookieOptions() {
  const isProd = process.env.NODE_ENV === "production";
  return {
    httpOnly: true,
    secure: isProd ? true : false,
    sameSite: isProd ? "none" : "lax",
    path: "/",
  };
}

function setAuthCookies(res, accessToken, refreshToken) {
  res.cookie("access_token", accessToken, {
    ...cookieOptions(),
    maxAge: 15 * 60 * 1000,
  });
  res.cookie("refresh_token", refreshToken, {
    ...cookieOptions(),
    maxAge: REFRESH_TTL_MS,
  });
}

function clearAuthCookies(res) {
  res.clearCookie("access_token", cookieOptions());
  res.clearCookie("refresh_token", cookieOptions());
}

function requireAuth(req, res, next) {
  const token = req.cookies?.access_token;
  if (!token) return res.status(401).json({ message: "No access token" });

  try {
    req.user = jwt.verify(token, ACCESS_SECRET);
    return next();
  } catch {
    return res.status(401).json({ message: "Invalid/expired access token" });
  }
}

function optionalAuth(req, res, next) {
  const token = req.cookies?.access_token;
  if (!token) {
    req.user = null;
    return next();
  }

  try {
    req.user = jwt.verify(token, ACCESS_SECRET);
  } catch {
    req.user = null;
  }
  return next();
}

function makeOtpCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

app.get("/health", (req, res) => res.json({ ok: true }));

app.post("/api/upload", requireAuth, (req, res) => {
  upload.single("file")(req, res, (err) => {
    if (err) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res
          .status(413)
          .json({ message: "Fayl çox böyükdür (max 25MB)" });
      }
      return res.status(400).json({ message: "Fayl yüklənmədi" });
    }

    if (!req.file) return res.status(400).json({ message: "Fayl tapılmadı" });

    const origin =
      process.env.FRONTEND_API_ORIGIN || `${req.protocol}://${req.get("host")}`;

    return res.json({
      url: `${origin.replace(/\/$/, "")}/uploads/${req.file.filename}`,
      name: req.file.originalname,
      type: req.file.mimetype,
      size: req.file.size,
    });
  });
});

app.get("/api/stickers", requireAuth, (req, res) => {
  return res.json(getStickersForUser(req.user.username));
});

app.post("/api/stickers", requireAuth, (req, res) => {
  const { url, name } = req.body || {};
  if (!url || typeof url !== "string") {
    return res.status(400).json({ message: "Sticker URL is required" });
  }
  const sticker = addSticker({
    id: randomUUID(),
    ownerUsername: req.user.username,
    url,
    name: name || null,
  });
  return res.json(sticker);
});

app.delete("/api/stickers/:id", requireAuth, (req, res) => {
  const removed = deleteSticker(req.params.id, req.user.username);
  if (!removed) return res.status(404).json({ message: "Sticker not found" });
  return res.json({ ok: true });
});

// STATUSES — visible to every registered user (no contacts list in this
// app), each auto-expiring 24h after posting.
app.get("/api/status", requireAuth, (req, res) => {
  const feed = getActiveStatusesFeed(req.user.username).map((s) => {
    const author = findUserByUsername(s.username);
    return { ...s, avatarUrl: author?.avatarUrl || null };
  });
  return res.json(feed);
});

app.post("/api/status", requireAuth, (req, res) => {
  const { type, text, mediaUrl, bgColor } = req.body || {};
  const kind = type === "image" ? "image" : type === "video" ? "video" : "text";

  if (kind === "text" && !String(text || "").trim()) {
    return res.status(400).json({ message: "Status text is required" });
  }
  if ((kind === "image" || kind === "video") && !mediaUrl) {
    return res.status(400).json({ message: "Status media is required" });
  }

  const status = addStatus({
    id: randomUUID(),
    username: req.user.username,
    type: kind,
    text: text ? String(text).slice(0, 700) : null,
    mediaUrl: mediaUrl || null,
    bgColor: bgColor || null,
  });

  const author = findUserById(req.user.sub);
  const payload = { ...status, avatarUrl: author?.avatarUrl || null };

  // "viewed" is only true for the author (their own status is trivially
  // seen) — broadcast without it so every other client's socket handler
  // computes it per-viewer instead of trusting a one-size-fits-all flag.
  io.emit("status:new", payload);
  return res.json({ ...payload, viewed: true });
});

app.post("/api/status/:id/view", requireAuth, (req, res) => {
  const status = getStatusById(req.params.id);
  if (!status) return res.status(404).json({ message: "Status not found" });

  if (status.username !== req.user.username) {
    markStatusViewed(status.id, req.user.username);

    const ownerSocketId = onlineSockets.get(status.username);
    if (ownerSocketId) {
      io.to(ownerSocketId).emit("status:viewed", {
        statusId: status.id,
        viewer: req.user.username,
        viewedAt: Date.now(),
      });
    }
  }
  return res.json({ ok: true });
});

app.get("/api/status/:id/viewers", requireAuth, (req, res) => {
  const status = getStatusById(req.params.id);
  if (!status) return res.status(404).json({ message: "Status not found" });
  if (status.username !== req.user.username) {
    return res.status(403).json({ message: "Not your status" });
  }
  const viewers = getStatusViewers(status.id).map((v) => {
    const u = findUserByUsername(v.username);
    return { ...v, avatarUrl: u?.avatarUrl || null };
  });
  return res.json(viewers);
});

app.delete("/api/status/:id", requireAuth, (req, res) => {
  const status = getStatusById(req.params.id);
  if (!status || status.username !== req.user.username) {
    return res.status(404).json({ message: "Status not found" });
  }
  deleteStatus(status.id, req.user.username);
  if (status.mediaUrl) deleteUploadedFileFromUrl(status.mediaUrl);

  io.emit("status:deleted", { id: status.id, username: status.username });
  return res.json({ ok: true });
});

app.get("/api/push/vapid-public-key", (req, res) => {
  return res.json({ key: VAPID_PUBLIC_KEY });
});

app.post("/api/push/subscribe", requireAuth, (req, res) => {
  const sub = req.body?.subscription;
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
    return res.status(400).json({ message: "Invalid push subscription" });
  }
  addPushSubscription({
    id: randomUUID(),
    username: req.user.username,
    endpoint: sub.endpoint,
    p256dh: sub.keys.p256dh,
    auth: sub.keys.auth,
  });
  return res.json({ ok: true });
});

app.post("/api/push/unsubscribe", requireAuth, (req, res) => {
  const endpoint = req.body?.endpoint;
  if (!endpoint) return res.status(400).json({ message: "Missing endpoint" });
  deletePushSubscriptionByEndpoint(endpoint);
  return res.json({ ok: true });
});

app.post("/api/rooms/create", (req, res) => {
  const room = `room_${randomUUID().slice(0, 8)}`;
  const token = signInvite(room);

  const origin =
    process.env.FRONTEND_ORIGIN ||
    (req.headers.origin ? String(req.headers.origin) : "http://localhost:5173");

  const inviteUrl = `${origin.replace(/\/$/, "")}/?invite=${encodeURIComponent(token)}`;

  return res.json({ room, inviteUrl, expiresIn: INVITE_EXPIRES_IN });
});

app.get("/api/invites/resolve", (req, res) => {
  const token = String(req.query.invite || "");
  if (!token) return res.status(400).json({ message: "Missing invite token" });

  try {
    const payload = jwt.verify(token, INVITE_SECRET);
    return res.json({ room: payload.room });
  } catch {
    return res.status(400).json({ message: "Invalid/expired invite token" });
  }
});

app.post("/api/register/request-otp", async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const username = normalizeUsername(req.body?.username);
  const password = String(req.body?.password || "");

  if (!isEmailLike(email))
    return res.status(400).json({ message: "Email düzgün deyil" });
  if (username.length < 3)
    return res.status(400).json({ message: "Username min 3 simvol" });
  if (password.length < 6)
    return res.status(400).json({ message: "Password min 6 simvol" });

  try {
    deleteExpiredOtps();
  } catch {}

  if (findUserByEmail(email))
    return res.status(409).json({ message: "Bu email artıq var" });
  if (findUserByUsername(username))
    return res.status(409).json({ message: "Bu username artıq var" });

  const passHash = await bcrypt.hash(password, 10);

  const code = makeOtpCode();
  const codeHash = await bcrypt.hash(code, 10);

  upsertOtp({
    email,
    codeHash,
    expiresAt: Date.now() + OTP_TTL_MS,
    username,
    passHash,
  });

  try {
    await sendOtpEmail(email, code);
  } catch (e) {
    console.log("❌ OTP email göndərilmədi:", e?.message || e);
    return res.status(500).json({ message: "OTP email göndərilmədi" });
  }

  return res.json({
    ok: true,
    message: "OTP göndərildi",
    expiresInSec: Math.floor(OTP_TTL_MS / 1000),
  });
});

app.post("/api/register/verify-otp", async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const code = String(req.body?.code || "").trim();

  if (!isEmailLike(email))
    return res.status(400).json({ message: "Email düzgün deyil" });
  if (code.length !== 6)
    return res.status(400).json({ message: "OTP 6 rəqəm olmalıdır" });

  const entry = getOtp(email);
  if (!entry)
    return res.status(400).json({ message: "OTP tapılmadı, yenidən göndər" });

  if (Date.now() > entry.expiresAt) {
    deleteOtp(email);
    return res.status(400).json({ message: "OTP vaxtı bitdi, yenidən göndər" });
  }

  const ok = await bcrypt.compare(code, entry.codeHash);
  if (!ok) return res.status(400).json({ message: "OTP yanlışdır" });

  if (findUserByEmail(email))
    return res.status(409).json({ message: "Bu email artıq var" });
  if (findUserByUsername(entry.username))
    return res.status(409).json({ message: "Bu username artıq var" });

  const user = {
    id: randomUUID(),
    username: entry.username,
    email,
    passHash: entry.passHash,
  };

  try {
    createUser(user);
  } catch (e) {
    console.log("❌ createUser error:", e?.message || e);
    return res.status(500).json({ message: "DB error: " + (e?.message || e) });
  } finally {
    deleteOtp(email);
  }

  const access = signAccess(user);
  const refresh = signRefresh(user);

  storeRefreshToken({
    token: refresh,
    userId: user.id,
    expiresAt: Date.now() + REFRESH_TTL_MS,
  });

  setAuthCookies(res, access, refresh);
  return res.json({ id: user.id, username: user.username, email: user.email });
});

app.post("/api/login", async (req, res) => {
  const identifier = String(
    req.body?.identifier ?? req.body?.username ?? "",
  ).trim();
  const password = String(req.body?.password || "");

  const user = findUserByIdentifier(identifier);
  if (!user)
    return res
      .status(401)
      .json({ code: "WRONG_CREDENTIALS", message: "Wrong credentials" });

  const ok = await bcrypt.compare(password, user.passHash);
  if (!ok)
    return res
      .status(401)
      .json({ code: "WRONG_CREDENTIALS", message: "Wrong credentials" });

  const access = signAccess(user);
  const refresh = signRefresh(user);

  storeRefreshToken({
    token: refresh,
    userId: user.id,
    expiresAt: Date.now() + REFRESH_TTL_MS,
  });

  setAuthCookies(res, access, refresh);
  return res.json({ id: user.id, username: user.username, email: user.email });
});

app.post("/api/logout", (req, res) => {
  const rt = req.cookies?.refresh_token;
  if (rt) revokeRefreshToken(rt);

  clearAuthCookies(res);
  return res.json({ ok: true });
});

app.post("/api/logout-all", requireAuth, (req, res) => {
  revokeAllRefreshTokensForUser(req.user.sub);
  clearAuthCookies(res);
  return res.json({ ok: true });
});

app.post("/api/refresh", (req, res) => {
  const rt = req.cookies?.refresh_token;
  if (!rt) return res.status(401).json({ message: "No refresh token" });

  const rec = getRefreshTokenRecord(rt);
  if (!rec) return res.status(401).json({ message: "Refresh revoked" });
  if (rec.revokedAt)
    return res.status(401).json({ message: "Refresh revoked" });

  if (Date.now() > rec.expiresAt) {
    revokeRefreshToken(rt);
    return res.status(401).json({ message: "Refresh expired" });
  }

  let payload;
  try {
    payload = jwt.verify(rt, REFRESH_SECRET);
  } catch {
    revokeRefreshToken(rt);
    return res.status(401).json({ message: "Invalid refresh token" });
  }

  const user = findUserById(payload.sub);
  if (!user) {
    revokeRefreshToken(rt);
    return res.status(401).json({ message: "User not found" });
  }

  revokeRefreshToken(rt);

  const newAccess = signAccess(user);
  const newRefresh = signRefresh(user);

  storeRefreshToken({
    token: newRefresh,
    userId: user.id,
    expiresAt: Date.now() + REFRESH_TTL_MS,
  });

  setAuthCookies(res, newAccess, newRefresh);

  try {
    deleteExpiredRefreshTokens();
  } catch {}

  return res.json({ ok: true });
});

app.get("/api/me", optionalAuth, (req, res) => {
  if (!req.user) {
    return res.json({
      authenticated: false,
      id: null,
      username: null,
      email: null,
    });
  }

  const user = findUserById(req.user.sub);
  return res.json({
    authenticated: true,
    id: req.user.sub,
    username: req.user.username,
    email: user?.email || null,
    avatarUrl: user?.avatarUrl || null,
    about: user?.about || null,
  });
});

app.patch("/api/me/profile", requireAuth, (req, res) => {
  const { avatarUrl, about } = req.body || {};
  if (avatarUrl !== undefined && avatarUrl !== null && typeof avatarUrl !== "string") {
    return res.status(400).json({ message: "Invalid avatarUrl" });
  }
  if (about !== undefined && about !== null && typeof about !== "string") {
    return res.status(400).json({ message: "Invalid about" });
  }
  const current = findUserById(req.user.sub);
  updateUserProfile(req.user.sub, {
    avatarUrl: avatarUrl !== undefined ? avatarUrl : current?.avatarUrl,
    about: about !== undefined ? String(about).slice(0, 140) : current?.about,
  });
  const updated = findUserById(req.user.sub);
  return res.json({
    avatarUrl: updated?.avatarUrl || null,
    about: updated?.about || null,
  });
});

app.post("/api/me/password", requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ message: "Missing password fields" });
  }
  if (String(newPassword).length < 6) {
    return res.status(400).json({ message: "Yeni şifrə ən azı 6 simvol olmalıdır" });
  }
  const user = findUserById(req.user.sub);
  if (!user) return res.status(404).json({ message: "User not found" });

  const ok = await bcrypt.compare(String(currentPassword), user.passHash);
  if (!ok) return res.status(401).json({ message: "Cari şifrə yanlışdır" });

  const newHash = await bcrypt.hash(String(newPassword), 10);
  updateUserPassword(req.user.sub, newHash);
  return res.json({ ok: true });
});

const io = new Server(server, {
  cors: { origin: FRONTEND_ORIGIN, credentials: true },
  maxHttpBufferSize: 5e6,
  // Mobile browsers routinely suspend JS/networking for tens of seconds
  // when a tab is backgrounded (screen lock, app switch) without the user
  // actually leaving. Generous ping timings plus connection state recovery
  // let a socket survive that instead of tripping "disconnect" every time.
  pingTimeout: 60000,
  pingInterval: 25000,
  connectionStateRecovery: {
    maxDisconnectionDuration: 2 * 60 * 1000,
  },
});

function parseCookies(cookieHeader) {
  const out = {};
  if (!cookieHeader) return out;
  cookieHeader.split(";").forEach((part) => {
    const [k, ...v] = part.trim().split("=");
    out[k] = decodeURIComponent(v.join("="));
  });
  return out;
}

io.use((socket, next) => {
  try {
    const cookieHeader = socket.handshake.headers.cookie;
    const cookies = parseCookies(cookieHeader);
    const token = cookies.access_token;
    if (!token) return next(new Error("NO_ACCESS_TOKEN"));

    const payload = jwt.verify(token, ACCESS_SECRET);
    socket.user = { id: payload.sub, username: payload.username };
    return next();
  } catch {
    return next(new Error("BAD_ACCESS_TOKEN"));
  }
});

const roomUsers = new Map();
const onlineSockets = new Map(); // username -> socket.id
const pendingLeaves = new Map(); // username -> timeout handle

// Whether the user's tab/app is actually foregrounded right now (Page
// Visibility API, reported by the client). A socket can stay connected for
// a while after the app is backgrounded/closed on mobile, so this is the
// signal that decides whether a new message still needs a push
// notification — defaults to visible so a message sent in the instant
// between connecting and the client's first visibility report isn't
// double-notified.
const visibleUsers = new Map(); // username -> boolean

// How long to wait after a socket disconnects before treating the user as
// actually gone (ending their call, posting "left", dropping them from the
// room). Covers brief network blips and mobile backgrounding/screen-lock,
// which otherwise trip a disconnect within seconds even though the user
// never left and their call/RTCPeerConnection may still be alive.
const DISCONNECT_GRACE_MS = 15000;

// ── Group calls ──
// One live call session per room at a time. A session tracks every invited
// participant's status ('ringing'|'joined'|'declined'|'left') so the call
// can keep going as long as 2+ people remain, ending only when it drops to
// <=1 — see maybeEndCall().
const MAX_CALL_PARTICIPANTS = 6;
const activeCallSessions = new Map(); // callId -> CallSession
const activeCallByUser = new Map(); // username -> callId
const activeCallByRoom = new Map(); // room -> callId

function emitUsers(room) {
  const users = Array.from(roomUsers.get(room) || []);
  io.to(room).emit("room:users", { room, users });
}

function emitCallHistoryUpdate(row) {
  if (!row) return;
  (row.participants || []).forEach((p) => {
    const socketId = onlineSockets.get(p.username);
    if (socketId) io.to(socketId).emit("call:history:update", row);
  });
}

function callSnapshot(session) {
  return Array.from(session.participants.entries()).map(([username, p]) => ({
    username,
    status: p.status,
  }));
}

function emitToParticipants(session, event, payload, { exclude } = {}) {
  session.participants.forEach((p, username) => {
    if (exclude && username === exclude) return;
    const socketId = onlineSockets.get(username);
    if (socketId) io.to(socketId).emit(event, payload);
  });
}

io.on("connection", (socket) => {
  socket.on("auth:join", ({ room }) => {
    const r = String(room || "general").trim() || "general";
    const u = socket.user.username;

    socket.data.room = r;
    socket.join(r);

    const wasPendingLeave = pendingLeaves.has(u);
    if (wasPendingLeave) {
      clearTimeout(pendingLeaves.get(u));
      pendingLeaves.delete(u);
    }

    if (!roomUsers.has(r)) roomUsers.set(r, new Set());
    roomUsers.get(r).add(u);
    onlineSockets.set(u, socket.id);

    const rawHistory = getRecentMessages(r, 50);
    const deletedForMe = getDeletedMessageIdsForUser(socket.user.id, r);

    const msgMap = new Map();
    rawHistory.forEach((m) => msgMap.set(m.id, m));

    const history = rawHistory
      .filter((m) => !deletedForMe.has(m.id))
      .map((m) => {
        let replyToData = null;
        if (m.replyTo) {
          const replied = msgMap.get(m.replyTo) || getMessageById(m.replyTo);
          if (replied && !replied.deletedForAll) {
            replyToData = {
              id: replied.id,
              username: replied.username,
              text:
                replied.text.length > 80
                  ? replied.text.slice(0, 80) + "..."
                  : replied.text,
            };
          }
        }

        if (m.deletedForAll)
          return { ...m, text: "Bu mesaj silindi", replyToData: null };
        return { ...m, replyToData };
      });

    socket.emit("room:history", history);
    socket.emit("room:joined", {
      room: r,
      users: Array.from(roomUsers.get(r)),
    });
    socket.emit("call:history", getCallHistoryForRoom(r, 200));

    // If a call is already in progress in this room, let the (re)joining
    // user ring in on it too, whether or not they were originally invited.
    const liveCallId = activeCallByRoom.get(r);
    if (liveCallId) {
      const session = activeCallSessions.get(liveCallId);
      if (session && !session.participants.has(u)) {
        session.participants.set(u, {
          status: "ringing",
          joinedAt: null,
          leftAt: null,
        });
        addCallParticipant(liveCallId, u);
      }
      if (session) {
        socket.emit("call:ring", {
          callId: session.id,
          room: r,
          callType: session.callType,
          from: session.starter,
          participants: callSnapshot(session),
        });
      }
    }

    // Any messages from the other participant that arrived while `u` was
    // offline are "delivered" the moment they reconnect and get history.
    const { deliveredAt, changed } = markDeliveredForRoomExceptUser(
      r,
      u,
      Date.now(),
    );
    if (changed) {
      const otherUser = Array.from(roomUsers.get(r) || []).find(
        (x) => x !== u,
      );
      const otherSocketId = otherUser && onlineSockets.get(otherUser);
      if (otherSocketId) {
        io.to(otherSocketId).emit("message:deliveredReceipt", {
          room: r,
          deliveredUpTo: Date.now(),
          deliveredAt,
        });
      }
    }

    // A resumed session (reconnect within the disconnect grace period)
    // never actually "left", so don't spam the room with join/leave noise.
    if (!wasPendingLeave) {
      // NOTE: "text" is an English fallback for old clients / old DB rows.
      // New clients should use systemKey + systemUser and translate locally
      // via translations.js -> userJoined / userLeft.
      const sysMsg = {
        id: randomUUID(),
        room: r,
        clientId: null,
        username: null,
        text: `${u} joined`,
        systemKey: "userJoined",
        systemUser: u,
        system: true,
        createdAt: Date.now(),
      };

      addMessage(sysMsg);
      io.to(r).emit("message:new", sysMsg);
    }
    emitUsers(r);
  });

  socket.on("presence:visibility", ({ visible }) => {
    const u = socket.user?.username;
    if (!u) return;
    visibleUsers.set(u, !!visible);
  });

  socket.on(
    "message:send",
    ({ room, text, clientId, replyTo, attachment, type, voiceData }) => {
      const r =
        String(room || socket.data.room || "general").trim() || "general";
      const msgType =
        type === "voice" ? "voice" :
        type === "sticker" ? "sticker" :
        type === "video_note" ? "video_note" :
        "text";
      const t = String(text || "").trim();

      let att = null;
      if (attachment && attachment.url && attachment.name) {
        att = {
          url: String(attachment.url),
          name: String(attachment.name),
          type: attachment.type
            ? String(attachment.type)
            : "application/octet-stream",
          size: typeof attachment.size === "number" ? attachment.size : null,
        };
      }

      if (msgType === "voice" && !voiceData) return;
      if (msgType === "sticker" && !att) return;
      if (msgType === "video_note" && !att) return;
      if (msgType === "text" && !t && !att) return;

      let replyToData = null;
      if (replyTo) {
        const repliedMsg = getMessageById(String(replyTo));
        if (repliedMsg && !repliedMsg.deletedForAll) {
          replyToData = {
            id: repliedMsg.id,
            username: repliedMsg.username,
            text:
              repliedMsg.text.length > 80
                ? repliedMsg.text.slice(0, 80) + "..."
                : repliedMsg.text,
          };
        }
      }

      const msg = {
        id: randomUUID(),
        room: r,
        clientId: clientId ? String(clientId) : null,
        username: socket.user.username,
        text: msgType === "voice" ? t || "Voice message" : t,
        system: false,
        createdAt: Date.now(),
        replyTo: replyTo ? String(replyTo) : null,
        replyToData,
        editedAt: null,
        deletedForAll: 0,
        readAt: null,
        deliveredAt: null,
        attachmentUrl: att?.url || null,
        attachmentName: att?.name || null,
        attachmentType: att?.type || null,
        attachmentSize: att?.size ?? null,
        type: msgType,
        voiceUrl: msgType === "voice" ? voiceData : null,
      };

      addMessage({ ...msg, attachment: att });

      const otherUser = Array.from(roomUsers.get(r) || []).find(
        (x) => x !== socket.user.username,
      );
      const otherIsOnline = otherUser && onlineSockets.has(otherUser);
      if (otherIsOnline) {
        const { deliveredAt } = markDeliveredForRoomExceptUser(
          r,
          socket.user.username,
          msg.createdAt,
        );
        msg.deliveredAt = deliveredAt;
      }

      // Push whenever the recipient isn't actually looking at the app right
      // now — either fully offline, or connected but backgrounded/closed
      // (a socket can outlive that by a while on mobile, so "online" alone
      // isn't a reliable signal that they'll see the in-app message).
      if (otherUser && (!otherIsOnline || visibleUsers.get(otherUser) === false)) {
        let preview = t;
        if (msgType === "voice") preview = "🎤 Səs mesajı";
        else if (msgType === "sticker") preview = "Stiker göndərdi";
        else if (msgType === "video_note") preview = "🎥 Video mesaj";
        else if (att && !t) preview = `📎 ${att.name}`;
        if (preview && preview.length > 120) preview = preview.slice(0, 120) + "...";

        sendPushToUser(otherUser, {
          title: socket.user.username,
          body: preview || "Yeni mesaj",
          room: r,
        }).catch((err) => console.log("❌ Push notify error:", err?.message || err));
      }

      io.to(r).emit("message:new", msg);
      socket.emit("message:delivered", {
        clientId: msg.clientId,
        messageId: msg.id,
      });

      if (msgType === "text" && t.startsWith("/")) {
        computeBotReply(t)
          .then((reply) => {
            if (!reply) return;
            const botMsg = {
              id: randomUUID(),
              room: r,
              clientId: null,
              username: BOT_USERNAME,
              text: reply,
              system: false,
              createdAt: Date.now(),
              replyTo: null,
              type: "text",
            };
            addMessage(botMsg);
            io.to(r).emit("message:new", botMsg);
          })
          .catch((e) => console.log("❌ Bot reply error:", e?.message || e));
      }
    },
  );

  socket.on("message:read", ({ room, readUpTo }) => {
    const r = String(room || socket.data.room || "general").trim() || "general";
    if (!readUpTo) return;

    try {
      const readAt = markReadForRoomExceptUser(
        r,
        socket.user.username,
        readUpTo,
      );
      socket.to(r).emit("message:seen", {
        readUpTo,
        readAt,
        reader: socket.user.username,
      });
    } catch (e) {
      console.log("read_at update error:", e?.message || e);
      socket.to(r).emit("message:seen", { readUpTo });
    }
  });

  socket.on("typing", ({ room, isTyping }) => {
    const r = String(room || socket.data.room || "general").trim() || "general";
    socket
      .to(r)
      .emit("typing", { username: socket.user.username, isTyping: !!isTyping });
  });

  socket.on("message:edit", ({ messageId, newText }) => {
    if (!messageId || !newText) return;

    let msg = getMessageById(String(messageId));
    if (!msg) msg = getMessageByClientId(String(messageId));
    if (!msg) return;

    if (msg.username !== socket.user.username) return;
    if (msg.system) return;
    if (msg.deletedForAll) return;

    const trimmed = String(newText).trim();
    if (!trimmed) return;

    updateMessageText(msg.id, trimmed);
    const editedAt = Date.now();

    io.to(msg.room).emit("message:edited", {
      messageId: msg.id,
      newText: trimmed,
      editedAt,
    });
  });

  socket.on("message:delete", ({ messageId, deleteFor }) => {
    if (!messageId) return;

    let msg = getMessageById(String(messageId));
    if (!msg) msg = getMessageByClientId(String(messageId));
    if (!msg) return;

    if (deleteFor === "everyone") {
      if (msg.username !== socket.user.username) return;
      if (msg.system) return;

      softDeleteMessageForAll(msg.id);
      io.to(msg.room).emit("message:deleted", {
        messageId: msg.id,
        deletedFor: "everyone",
      });
    } else {
      deleteMessageForUser(socket.user.id, msg.id);
      socket.emit("message:deleted", { messageId: msg.id, deletedFor: "me" });
    }
  });

  socket.on("call:start", ({ room, callType }) => {
    const starter = socket.user.username;
    const r = String(room || socket.data.room || "").trim();
    if (!r) return;
    const type = callType === "video" ? "video" : "audio";

    const existingCallId = activeCallByRoom.get(r);
    if (existingCallId) {
      // A call is already live in this room — join it instead of ringing
      // a brand-new session.
      handleCallJoin(socket, existingCallId);
      return;
    }

    const invitees = Array.from(roomUsers.get(r) || []).filter(
      (u) => u !== starter && onlineSockets.has(u),
    );

    const callId = randomUUID();
    const session = {
      id: callId,
      room: r,
      callType: type,
      starter,
      startedAt: Date.now(),
      everActive: false,
      participants: new Map(),
    };
    session.participants.set(starter, {
      status: "joined",
      joinedAt: session.startedAt,
      leftAt: null,
    });
    invitees.forEach((u) =>
      session.participants.set(u, { status: "ringing", joinedAt: null, leftAt: null }),
    );

    activeCallSessions.set(callId, session);
    activeCallByRoom.set(r, callId);
    activeCallByUser.set(starter, callId);
    invitees.forEach((u) => activeCallByUser.set(u, callId));

    createCallSession({ id: callId, room: r, starter, callType: type });
    invitees.forEach((u) => addCallParticipant(callId, u));
    emitCallHistoryUpdate(getCallHistoryRowById(callId));

    socket.emit("call:started", {
      callId,
      room: r,
      callType: type,
      participants: callSnapshot(session),
    });
    invitees.forEach((u) => {
      const sid = onlineSockets.get(u);
      if (sid) {
        io.to(sid).emit("call:ring", {
          callId,
          room: r,
          callType: type,
          from: starter,
          participants: callSnapshot(session),
        });
      }

      // A connected-but-backgrounded socket won't render the incoming-call
      // screen (the app is suspended), so push a notification the same way
      // an offline recipient would get one for a message.
      if (visibleUsers.get(u) === false) {
        sendPushToUser(u, {
          title: starter,
          body: type === "video" ? "📹 Görüntülü zəng" : "📞 Səsli zəng",
          room: r,
          type: "call",
        }).catch((err) => console.log("❌ Call push notify error:", err?.message || err));
      }
    });
  });

  socket.on("call:join", ({ callId }) => {
    handleCallJoin(socket, String(callId || ""));
  });

  socket.on("call:decline", ({ callId }) => {
    const username = socket.user.username;
    const id = String(callId || "");
    const session = activeCallSessions.get(id);
    if (!session || !session.participants.has(username)) return;

    session.participants.set(username, {
      ...session.participants.get(username),
      status: "declined",
      leftAt: Date.now(),
    });
    if (activeCallByUser.get(username) === id) activeCallByUser.delete(username);
    markParticipantStatus(id, username, "declined");

    emitCallHistoryUpdate(getCallHistoryRowById(id));
    emitToParticipants(session, "call:participant-declined", { callId: id, username });
    maybeEndCall(id);
  });

  socket.on("call:leave", ({ callId }) => {
    const username = socket.user.username;
    const id = String(callId || "");
    const session = activeCallSessions.get(id);
    if (!session || !session.participants.has(username)) return;

    session.participants.set(username, {
      ...session.participants.get(username),
      status: "left",
      leftAt: Date.now(),
    });
    if (activeCallByUser.get(username) === id) activeCallByUser.delete(username);
    markParticipantStatus(id, username, "left");

    emitCallHistoryUpdate(getCallHistoryRowById(id));
    emitToParticipants(session, "call:participant-left", {
      callId: id,
      username,
      reason: "hangup",
    });
    maybeEndCall(id);
  });

  socket.on("call:offer", ({ callId, to, offer }) => {
    if (!activeCallSessions.has(String(callId || ""))) return;
    const targetSocketId = onlineSockets.get(String(to || ""));
    if (targetSocketId)
      io.to(targetSocketId).emit("call:offer", {
        callId,
        from: socket.user.username,
        offer,
      });
  });

  socket.on("call:answer", ({ callId, to, answer }) => {
    if (!activeCallSessions.has(String(callId || ""))) return;
    const targetSocketId = onlineSockets.get(String(to || ""));
    if (targetSocketId)
      io.to(targetSocketId).emit("call:answer", {
        callId,
        from: socket.user.username,
        answer,
      });
  });

  socket.on("call:ice-candidate", ({ callId, to, candidate }) => {
    if (!activeCallSessions.has(String(callId || ""))) return;
    const targetSocketId = onlineSockets.get(String(to || ""));
    if (targetSocketId)
      io.to(targetSocketId).emit("call:ice-candidate", {
        callId,
        from: socket.user.username,
        candidate,
      });
  });

  socket.on("disconnect", () => {
    const r = socket.data.room;
    const u = socket.user?.username;
    if (!u) return;

    // A stale socket for a user who already reconnected on a newer one
    // must not tear down their current session.
    if (onlineSockets.get(u) !== socket.id) return;

    const existingTimer = pendingLeaves.get(u);
    if (existingTimer) clearTimeout(existingTimer);

    const timer = setTimeout(() => {
      pendingLeaves.delete(u);
      // The user reconnected (same or new socket) during the grace
      // window — nothing to clean up.
      if (onlineSockets.get(u) !== socket.id) return;

      finalizeDisconnect(u, r, socket.id);
    }, DISCONNECT_GRACE_MS);

    pendingLeaves.set(u, timer);
  });
});

// Shared by "call:join" and a "call:start" into a room that already has a
// live call — both mean "add/mark this user as joined in this session".
function handleCallJoin(socket, callId) {
  const username = socket.user.username;
  const session = activeCallSessions.get(callId);
  if (!session) return;

  const alreadyJoined = session.participants.get(username)?.status === "joined";
  const joinedCount = Array.from(session.participants.values()).filter(
    (p) => p.status === "joined",
  ).length;
  if (!alreadyJoined && joinedCount >= MAX_CALL_PARTICIPANTS) {
    socket.emit("call:full", { callId });
    return;
  }

  if (!session.participants.has(username)) {
    addCallParticipant(callId, username);
  }
  session.participants.set(username, {
    status: "joined",
    joinedAt: Date.now(),
    leftAt: null,
  });
  activeCallByUser.set(username, callId);
  markParticipantJoined(callId, username);

  const nowJoined = Array.from(session.participants.values()).filter(
    (p) => p.status === "joined",
  ).length;
  if (nowJoined >= 2) session.everActive = true;

  emitCallHistoryUpdate(getCallHistoryRowById(callId));
  emitToParticipants(session, "call:participant-joined", {
    callId,
    username,
    participants: callSnapshot(session),
  });
}

// A call keeps going as long as 2+ participants remain joined (or are
// still being rung) — it only fully ends once that drops to <=1.
function maybeEndCall(callId) {
  const session = activeCallSessions.get(callId);
  if (!session) return;

  const entries = Array.from(session.participants.values());
  const joinedCount = entries.filter((p) => p.status === "joined").length;
  const ringingCount = entries.filter((p) => p.status === "ringing").length;

  if (joinedCount === 0 || (joinedCount === 1 && ringingCount === 0)) {
    const finalStatus = session.everActive ? "ended" : "no-participants";
    markCallSessionStatus(callId, finalStatus);
    emitCallHistoryUpdate(getCallHistoryRowById(callId));
    emitToParticipants(session, "call:ended", { callId, reason: finalStatus });

    activeCallSessions.delete(callId);
    if (activeCallByRoom.get(session.room) === callId) {
      activeCallByRoom.delete(session.room);
    }
    session.participants.forEach((_, username) => {
      if (activeCallByUser.get(username) === callId) {
        activeCallByUser.delete(username);
      }
    });
  }
}

function finalizeDisconnect(u, r, socketId) {
  if (onlineSockets.get(u) === socketId) {
    onlineSockets.delete(u);
    visibleUsers.delete(u);
  }

  const callId = activeCallByUser.get(u);
  if (callId) {
    const session = activeCallSessions.get(callId);
    if (session && session.participants.has(u)) {
      session.participants.set(u, {
        ...session.participants.get(u),
        status: "left",
        leftAt: Date.now(),
      });
      markParticipantStatus(callId, u, "left");
      emitCallHistoryUpdate(getCallHistoryRowById(callId));
      emitToParticipants(session, "call:participant-left", {
        callId,
        username: u,
        reason: "disconnect",
      });
      maybeEndCall(callId);
    }
    if (activeCallByUser.get(u) === callId) activeCallByUser.delete(u);
  }

  if (!r) return;

  const set = roomUsers.get(r);
  if (set) {
    set.delete(u);
    if (set.size === 0) roomUsers.delete(r);
  }

  {
    // NOTE: "text" is an English fallback; new clients should use
    // systemKey + systemUser and translate locally.
    const sysMsg = {
      id: randomUUID(),
      room: r,
      clientId: null,
      username: null,
      text: `${u} left`,
      systemKey: "userLeft",
      systemUser: u,
      system: true,
      createdAt: Date.now(),
    };

    addMessage(sysMsg);
    io.to(r).emit("message:new", sysMsg);
    emitUsers(r);
  }
}

// Statuses self-expire out of every GET /api/status response already —
// this sweep only exists so expired rows/uploaded media don't pile up
// forever, and so already-open clients drop them without needing a refetch.
const STATUS_SWEEP_INTERVAL_MS = 15 * 60 * 1000;
setInterval(() => {
  try {
    const expired = deleteExpiredStatuses();
    expired.forEach((row) => {
      if (row.mediaUrl) deleteUploadedFileFromUrl(row.mediaUrl);
      io.emit("status:deleted", { id: row.id });
    });
  } catch (e) {
    console.log("❌ Status sweep error:", e?.message || e);
  }
}, STATUS_SWEEP_INTERVAL_MS);

const PORT = process.env.PORT || 3001;
server.listen(PORT, () =>
  console.log(`Backend running on http://localhost:${PORT}`),
);