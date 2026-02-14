require("dotenv").config();

const express = require("express");
const http = require("http");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const { Server } = require("socket.io");
const { randomUUID } = require("crypto");

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
  })
);

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
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

  if (!isEmailLike(email)) return res.status(400).json({ message: "Email düzgün deyil" });
  if (username.length < 3) return res.status(400).json({ message: "Username min 3 simvol" });
  if (password.length < 6) return res.status(400).json({ message: "Password min 6 simvol" });

  try { deleteExpiredOtps(); } catch {}

  if (findUserByEmail(email)) return res.status(409).json({ message: "Bu email artıq var" });
  if (findUserByUsername(username)) return res.status(409).json({ message: "Bu username artıq var" });

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

  if (!isEmailLike(email)) return res.status(400).json({ message: "Email düzgün deyil" });
  if (code.length !== 6) return res.status(400).json({ message: "OTP 6 rəqəm olmalıdır" });

  const entry = getOtp(email);
  if (!entry) return res.status(400).json({ message: "OTP tapılmadı, yenidən göndər" });

  if (Date.now() > entry.expiresAt) {
    deleteOtp(email);
    return res.status(400).json({ message: "OTP vaxtı bitdi, yenidən göndər" });
  }

  const ok = await bcrypt.compare(code, entry.codeHash);
  if (!ok) return res.status(400).json({ message: "OTP yanlışdır" });

  if (findUserByEmail(email)) return res.status(409).json({ message: "Bu email artıq var" });
  if (findUserByUsername(entry.username)) return res.status(409).json({ message: "Bu username artıq var" });

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
  const identifier = String(req.body?.identifier ?? req.body?.username ?? "").trim();
  const password = String(req.body?.password || "");

  const user = findUserByIdentifier(identifier);
  if (!user) return res.status(401).json({ message: "Wrong credentials" });

  const ok = await bcrypt.compare(password, user.passHash);
  if (!ok) return res.status(401).json({ message: "Wrong credentials" });

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
  if (rec.revokedAt) return res.status(401).json({ message: "Refresh revoked" });

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
    return res.json({ authenticated: false, id: null, username: null, email: null });
  }

  const user = findUserById(req.user.sub);
  return res.json({
    authenticated: true,
    id: req.user.sub,
    username: req.user.username,
    email: user?.email || null,
  });
});


const io = new Server(server, {
  cors: { origin: FRONTEND_ORIGIN, credentials: true },
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

function emitUsers(room) {
  const users = Array.from(roomUsers.get(room) || []);
  io.to(room).emit("room:users", { room, users });
}

io.on("connection", (socket) => {
  socket.on("auth:join", ({ room }) => {
    const r = String(room || "general").trim() || "general";
    const u = socket.user.username;

    socket.data.room = r;
    socket.join(r);

    if (!roomUsers.has(r)) roomUsers.set(r, new Set());
    roomUsers.get(r).add(u);

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
              text: replied.text.length > 80 ? replied.text.slice(0, 80) + "..." : replied.text,
            };
          }
        }

        if (m.deletedForAll) return { ...m, text: "Bu mesaj silindi", replyToData: null };
        return { ...m, replyToData };
      });

    socket.emit("room:history", history);
    socket.emit("room:joined", { room: r, users: Array.from(roomUsers.get(r)) });

    const sysMsg = {
      id: randomUUID(),
      room: r,
      clientId: null,
      username: null,
      text: `${u} joined`,
      system: true,
      createdAt: Date.now(),
    };

    addMessage(sysMsg);
    io.to(r).emit("message:new", sysMsg);
    emitUsers(r);
  });

  socket.on("message:send", ({ room, text, clientId, replyTo }) => {
    const r = String(room || socket.data.room || "general").trim() || "general";
    const t = String(text || "").trim();
    if (!t) return;

    let replyToData = null;
    if (replyTo) {
      const repliedMsg = getMessageById(String(replyTo));
      if (repliedMsg && !repliedMsg.deletedForAll) {
        replyToData = {
          id: repliedMsg.id,
          username: repliedMsg.username,
          text: repliedMsg.text.length > 80 ? repliedMsg.text.slice(0, 80) + "..." : repliedMsg.text,
        };
      }
    }

    const msg = {
      id: randomUUID(),
      room: r,
      clientId: clientId ? String(clientId) : null,
      username: socket.user.username,
      text: t,
      system: false,
      createdAt: Date.now(),
      replyTo: replyTo ? String(replyTo) : null,
      replyToData,
      editedAt: null,
      deletedForAll: 0,
      readAt: null,
    };

    addMessage(msg);
    io.to(r).emit("message:new", msg);
    socket.emit("message:delivered", { clientId: msg.clientId, messageId: msg.id });
  });

  socket.on("message:read", ({ room, readUpTo }) => {
    const r = String(room || socket.data.room || "general").trim() || "general";
    if (!readUpTo) return;

    try {
      const readAt = markReadForRoomExceptUser(r, socket.user.username, readUpTo);
      socket.to(r).emit("message:seen", { readUpTo, readAt, reader: socket.user.username });
    } catch (e) {
      console.log("read_at update error:", e?.message || e);
      socket.to(r).emit("message:seen", { readUpTo });
    }
  });

  socket.on("typing", ({ room, isTyping }) => {
    const r = String(room || socket.data.room || "general").trim() || "general";
    socket.to(r).emit("typing", { username: socket.user.username, isTyping: !!isTyping });
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

    io.to(msg.room).emit("message:edited", { messageId: msg.id, newText: trimmed, editedAt });
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
      io.to(msg.room).emit("message:deleted", { messageId: msg.id, deletedFor: "everyone" });
    } else {
      deleteMessageForUser(socket.user.id, msg.id);
      socket.emit("message:deleted", { messageId: msg.id, deletedFor: "me" });
    }
  });

  socket.on("disconnect", () => {
    const r = socket.data.room;
    const u = socket.user?.username;
    if (!r || !u) return;

    const set = roomUsers.get(r);
    if (set) {
      set.delete(u);
      if (set.size === 0) roomUsers.delete(r);
    }

    const sysMsg = {
      id: randomUUID(),
      room: r,
      clientId: null,
      username: null,
      text: `${u} left`,
      system: true,
      createdAt: Date.now(),
    };

    addMessage(sysMsg);
    io.to(r).emit("message:new", sysMsg);
    emitUsers(r);
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`Backend running on http://localhost:${PORT}`));