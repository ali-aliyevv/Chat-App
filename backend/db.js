const path = require("path");
const Database = require("better-sqlite3");

const dbPath = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(__dirname, "data.sqlite");

const db = new Database(dbPath);
console.log("✅ Using SQLite DB:", dbPath);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA synchronous = NORMAL;
  PRAGMA temp_store = MEMORY;

  -- USERS
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL UNIQUE,
    pass_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
  CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);

  -- REFRESH TOKENS
  CREATE TABLE IF NOT EXISTS refresh_tokens (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    revoked_at INTEGER,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_refresh_user ON refresh_tokens(user_id);
  CREATE INDEX IF NOT EXISTS idx_refresh_expires ON refresh_tokens(expires_at);

  -- MESSAGES
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    room TEXT NOT NULL,
    client_id TEXT,
    username TEXT,
    text TEXT NOT NULL,
    system INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    edited_at INTEGER,
    deleted_for_all INTEGER NOT NULL DEFAULT 0,
    reply_to TEXT,
    read_at INTEGER
  );

  CREATE INDEX IF NOT EXISTS idx_messages_room_time ON messages(room, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_messages_client_id ON messages(client_id);

  -- DELETED MESSAGES (per-user "delete for me")
  CREATE TABLE IF NOT EXISTS deleted_messages (
    user_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    PRIMARY KEY (user_id, message_id)
  );

  CREATE INDEX IF NOT EXISTS idx_deleted_messages_user ON deleted_messages(user_id);

  -- ROOMS
  CREATE TABLE IF NOT EXISTS rooms (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    creator_id TEXT,
    created_at INTEGER NOT NULL,
    deleted_at INTEGER,
    FOREIGN KEY(creator_id) REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE INDEX IF NOT EXISTS idx_rooms_name ON rooms(name);
  CREATE INDEX IF NOT EXISTS idx_rooms_deleted ON rooms(deleted_at);

  -- ROOM INVITES
  CREATE TABLE IF NOT EXISTS room_invites (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL,
    invite_token TEXT NOT NULL UNIQUE,
    created_by TEXT,
    created_at INTEGER NOT NULL,
    expires_at INTEGER,
    used_count INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY(room_id) REFERENCES rooms(id) ON DELETE CASCADE,
    FOREIGN KEY(created_by) REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE INDEX IF NOT EXISTS idx_room_invites_token ON room_invites(invite_token);
  CREATE INDEX IF NOT EXISTS idx_room_invites_room ON room_invites(room_id);

  -- OTP (persist; survives restart)
  CREATE TABLE IF NOT EXISTS otp_codes (
    email TEXT PRIMARY KEY,
    code_hash TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    username TEXT NOT NULL,
    pass_hash TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_otp_expires ON otp_codes(expires_at);
`);

function ensureColumn(table, column, sqlType) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  const has = cols.some((c) => c.name === column);
  if (!has) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${sqlType};`);
    console.log(`✅ Migration: added ${table}.${column}`);
  }
}

try {
  ensureColumn("refresh_tokens", "revoked_at", "INTEGER");
  ensureColumn("messages", "client_id", "TEXT");
  ensureColumn("messages", "edited_at", "INTEGER");
  ensureColumn("messages", "deleted_for_all", "INTEGER DEFAULT 0");
  ensureColumn("messages", "reply_to", "TEXT");
  ensureColumn("messages", "read_at", "INTEGER");

  db.exec(`
    CREATE TABLE IF NOT EXISTS deleted_messages (
      user_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      PRIMARY KEY (user_id, message_id)
    );
  `);
} catch (e) {
  console.log("❌ Migration error:", e?.message || e);
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}
function normalizeUsername(username) {
  return String(username || "").trim();
}
function isEmailLike(s) {
  return /.+@.+\..+/.test(String(s || "").trim());
}


const stmtCreateUser = db.prepare(`
  INSERT INTO users (id, username, email, pass_hash, created_at)
  VALUES (@id, @username, @email, @pass_hash, @created_at)
`);

const stmtFindUserByEmail = db.prepare(
  `SELECT id, username, email, pass_hash as passHash FROM users WHERE email = ?`
);

const stmtFindUserByUsername = db.prepare(
  `SELECT id, username, email, pass_hash as passHash FROM users WHERE username = ?`
);

const stmtFindUserById = db.prepare(
  `SELECT id, username, email, pass_hash as passHash FROM users WHERE id = ?`
);

const stmtStoreRefresh = db.prepare(`
  INSERT OR REPLACE INTO refresh_tokens (token, user_id, created_at, expires_at, revoked_at)
  VALUES (?, ?, ?, ?, NULL)
`);

const stmtRevokeRefresh = db.prepare(`
  UPDATE refresh_tokens
  SET revoked_at = ?
  WHERE token = ? AND revoked_at IS NULL
`);

const stmtRevokeAllRefresh = db.prepare(`
  UPDATE refresh_tokens
  SET revoked_at = ?
  WHERE user_id = ? AND revoked_at IS NULL
`);

const stmtGetRefreshRecord = db.prepare(`
  SELECT token, user_id as userId, expires_at as expiresAt, revoked_at as revokedAt
  FROM refresh_tokens
  WHERE token = ?
`);

const stmtDeleteExpiredRefresh = db.prepare(`
  DELETE FROM refresh_tokens
  WHERE expires_at < ? OR revoked_at IS NOT NULL
`);

const stmtUpsertOtp = db.prepare(`
  INSERT INTO otp_codes (email, code_hash, expires_at, username, pass_hash)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(email) DO UPDATE SET
    code_hash=excluded.code_hash,
    expires_at=excluded.expires_at,
    username=excluded.username,
    pass_hash=excluded.pass_hash
`);

const stmtGetOtp = db.prepare(`
  SELECT email, code_hash as codeHash, expires_at as expiresAt, username, pass_hash as passHash
  FROM otp_codes
  WHERE email = ?
`);

const stmtDeleteOtp = db.prepare(`DELETE FROM otp_codes WHERE email = ?`);
const stmtDeleteExpiredOtps = db.prepare(`DELETE FROM otp_codes WHERE expires_at < ?`);

const stmtAddMessage = db.prepare(`
  INSERT INTO messages (id, room, client_id, username, text, system, created_at, reply_to)
  VALUES (@id, @room, @client_id, @username, @text, @system, @created_at, @reply_to)
`);

const stmtGetRecentMessages = db.prepare(`
  SELECT id, room, client_id as clientId, username, text, system,
         created_at as createdAt, edited_at as editedAt,
         deleted_for_all as deletedForAll, reply_to as replyTo,
         read_at as readAt
  FROM messages
  WHERE room = ?
  ORDER BY created_at DESC
  LIMIT ?
`);

const stmtGetMessageById = db.prepare(`
  SELECT id, room, client_id as clientId, username, text, system,
         created_at as createdAt, edited_at as editedAt,
         deleted_for_all as deletedForAll, reply_to as replyTo,
         read_at as readAt
  FROM messages WHERE id = ?
`);

const stmtGetMessageByClientId = db.prepare(`
  SELECT id, room, client_id as clientId, username, text, system,
         created_at as createdAt, edited_at as editedAt,
         deleted_for_all as deletedForAll, reply_to as replyTo,
         read_at as readAt
  FROM messages WHERE client_id = ?
`);

const stmtUpdateMessageText = db.prepare(`
  UPDATE messages SET text = ?, edited_at = ? WHERE id = ?
`);

const stmtSoftDeleteForAll = db.prepare(`
  UPDATE messages SET deleted_for_all = 1 WHERE id = ?
`);

const stmtDeleteMessageForUser = db.prepare(`
  INSERT OR IGNORE INTO deleted_messages (user_id, message_id) VALUES (?, ?)
`);

const stmtGetDeletedMessageIdsForUser = db.prepare(`
  SELECT dm.message_id as messageId
  FROM deleted_messages dm
  JOIN messages m ON m.id = dm.message_id
  WHERE dm.user_id = ? AND m.room = ?
`);

const stmtMarkReadForRoomExceptUser = db.prepare(`
  UPDATE messages
  SET read_at = ?
  WHERE room = ? AND username != ? AND created_at <= ? AND read_at IS NULL AND system = 0
`);


function createUser({ id, username, email, passHash }) {
  stmtCreateUser.run({
    id,
    username: normalizeUsername(username),
    email: normalizeEmail(email),
    pass_hash: passHash,
    created_at: Date.now(),
  });
}

function findUserByEmail(email) {
  return stmtFindUserByEmail.get(normalizeEmail(email));
}

function findUserByUsername(username) {
  return stmtFindUserByUsername.get(normalizeUsername(username));
}

function findUserById(id) {
  return stmtFindUserById.get(String(id));
}

function findUserByIdentifier(identifier) {
  const id = String(identifier || "").trim();
  if (!id) return null;
  if (isEmailLike(id)) return findUserByEmail(id);
  return findUserByUsername(id) || findUserByEmail(id);
}

function storeRefreshToken({ token, userId, expiresAt }) {
  stmtStoreRefresh.run(String(token), String(userId), Date.now(), Number(expiresAt));
}

function revokeRefreshToken(token) {
  stmtRevokeRefresh.run(Date.now(), String(token));
}

function revokeAllRefreshTokensForUser(userId) {
  stmtRevokeAllRefresh.run(Date.now(), String(userId));
}

function getRefreshTokenRecord(token) {
  return stmtGetRefreshRecord.get(String(token));
}

function deleteExpiredRefreshTokens() {
  stmtDeleteExpiredRefresh.run(Date.now());
}

function upsertOtp({ email, codeHash, expiresAt, username, passHash }) {
  stmtUpsertOtp.run(
    normalizeEmail(email),
    String(codeHash),
    Number(expiresAt),
    normalizeUsername(username),
    String(passHash)
  );
}

function getOtp(email) {
  return stmtGetOtp.get(normalizeEmail(email));
}

function deleteOtp(email) {
  stmtDeleteOtp.run(normalizeEmail(email));
}

function deleteExpiredOtps() {
  stmtDeleteExpiredOtps.run(Date.now());
}

function addMessage({ id, room, clientId, username, text, system, createdAt, replyTo }) {
  stmtAddMessage.run({
    id: String(id),
    room: String(room),
    client_id: clientId ? String(clientId) : null,
    username: username ?? null,
    text: String(text),
    system: system ? 1 : 0,
    created_at: typeof createdAt === "number" ? createdAt : Date.now(),
    reply_to: replyTo ? String(replyTo) : null,
  });
}

function getRecentMessages(room, limit = 50) {
  const rows = stmtGetRecentMessages.all(String(room), Number(limit));
  return rows.reverse();
}

function getMessageById(id) {
  return stmtGetMessageById.get(String(id));
}

function getMessageByClientId(clientId) {
  return stmtGetMessageByClientId.get(String(clientId));
}

function updateMessageText(id, newText) {
  stmtUpdateMessageText.run(String(newText), Date.now(), String(id));
}

function softDeleteMessageForAll(id) {
  stmtSoftDeleteForAll.run(String(id));
}

function deleteMessageForUser(userId, messageId) {
  stmtDeleteMessageForUser.run(String(userId), String(messageId));
}

function getDeletedMessageIdsForUser(userId, room) {
  const rows = stmtGetDeletedMessageIdsForUser.all(String(userId), String(room));
  return new Set(rows.map((r) => r.messageId));
}

function markReadForRoomExceptUser(room, username, readUpToTs) {
  const readAt = Date.now();
  stmtMarkReadForRoomExceptUser.run(readAt, String(room), String(username), Number(readUpToTs));
  return readAt;
}

/* ── Room helpers ── */

const stmtCreateRoom = db.prepare(`
  INSERT INTO rooms (id, name, creator_id, created_at)
  VALUES (?, ?, ?, ?)
`);

const stmtFindRoomById = db.prepare(`
  SELECT id, name, creator_id as creatorId, created_at as createdAt, deleted_at as deletedAt
  FROM rooms WHERE id = ? AND deleted_at IS NULL
`);

const stmtFindRoomByName = db.prepare(`
  SELECT id, name, creator_id as creatorId, created_at as createdAt, deleted_at as deletedAt
  FROM rooms WHERE name = ? AND deleted_at IS NULL
`);

const stmtSoftDeleteRoom = db.prepare(`
  UPDATE rooms SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL
`);

const stmtCleanupOldRooms = db.prepare(`
  DELETE FROM rooms WHERE deleted_at IS NOT NULL AND deleted_at < ?
`);

function createRoom({ id, name, creatorId }) {
  stmtCreateRoom.run(String(id), String(name), creatorId ? String(creatorId) : null, Date.now());
}

function findRoomById(id) {
  return stmtFindRoomById.get(String(id));
}

function findRoomByName(name) {
  return stmtFindRoomByName.get(String(name));
}

function softDeleteRoom(id) {
  stmtSoftDeleteRoom.run(Date.now(), String(id));
}

function cleanupOldRooms(maxAgeMs) {
  const cutoff = Date.now() - maxAgeMs;
  stmtCleanupOldRooms.run(cutoff);
}

/* ── Room invite helpers ── */

const stmtCreateInvite = db.prepare(`
  INSERT INTO room_invites (id, room_id, invite_token, created_by, created_at, expires_at)
  VALUES (?, ?, ?, ?, ?, ?)
`);

const stmtFindInviteByToken = db.prepare(`
  SELECT id, room_id as roomId, invite_token as inviteToken, created_by as createdBy,
         created_at as createdAt, expires_at as expiresAt, used_count as usedCount
  FROM room_invites WHERE invite_token = ?
`);

const stmtIncrementInviteUsedCount = db.prepare(`
  UPDATE room_invites SET used_count = used_count + 1 WHERE invite_token = ?
`);

const stmtCleanupExpiredInvites = db.prepare(`
  DELETE FROM room_invites WHERE expires_at IS NOT NULL AND expires_at < ?
`);

function createInvite({ id, roomId, inviteToken, createdBy, expiresAt }) {
  stmtCreateInvite.run(
    String(id), String(roomId), String(inviteToken),
    createdBy ? String(createdBy) : null, Date.now(),
    expiresAt ? Number(expiresAt) : null
  );
}

function findInviteByToken(token) {
  return stmtFindInviteByToken.get(String(token));
}

function incrementInviteUsedCount(token) {
  stmtIncrementInviteUsedCount.run(String(token));
}

function cleanupExpiredInvites() {
  stmtCleanupExpiredInvites.run(Date.now());
}

module.exports = {
  db,

  createUser,
  findUserByEmail,
  findUserByUsername,
  findUserById,
  findUserByIdentifier,

  storeRefreshToken,
  revokeRefreshToken,
  revokeAllRefreshTokensForUser,
  getRefreshTokenRecord,
  deleteExpiredRefreshTokens,

  upsertOtp,
  getOtp,
  deleteOtp,
  deleteExpiredOtps,

  addMessage,
  getRecentMessages,
  getMessageById,
  getMessageByClientId,
  updateMessageText,
  softDeleteMessageForAll,
  deleteMessageForUser,
  getDeletedMessageIdsForUser,
  markReadForRoomExceptUser,

  createRoom,
  findRoomById,
  findRoomByName,
  softDeleteRoom,
  cleanupOldRooms,

  createInvite,
  findInviteByToken,
  incrementInviteUsedCount,
  cleanupExpiredInvites,
};
