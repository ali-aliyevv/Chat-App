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
    created_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_messages_room_time
    ON messages(room, created_at DESC);

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

// USERS
function createUser({ id, username, email, passHash }) {
  db.prepare(`
    INSERT INTO users (id, username, email, pass_hash, created_at)
    VALUES (@id, @username, @email, @pass_hash, @created_at)
  `).run({
    id,
    username: normalizeUsername(username),
    email: normalizeEmail(email),
    pass_hash: passHash,
    created_at: Date.now(),
  });
}

function findUserByEmail(email) {
  const e = normalizeEmail(email);
  return db
    .prepare(
      `SELECT id, username, email, pass_hash as passHash FROM users WHERE email = ?`
    )
    .get(e);
}

function findUserByUsername(username) {
  const u = normalizeUsername(username);
  return db
    .prepare(
      `SELECT id, username, email, pass_hash as passHash FROM users WHERE username = ?`
    )
    .get(u);
}

function findUserById(id) {
  return db
    .prepare(
      `SELECT id, username, email, pass_hash as passHash FROM users WHERE id = ?`
    )
    .get(String(id));
}

function findUserByIdentifier(identifier) {
  const id = String(identifier || "").trim();
  if (!id) return null;

  if (isEmailLike(id)) return findUserByEmail(id);
  return findUserByUsername(id) || findUserByEmail(id);
}

// REFRESH TOKENS
function storeRefreshToken({ token, userId, expiresAt }) {
  db.prepare(`
    INSERT OR REPLACE INTO refresh_tokens (token, user_id, created_at, expires_at, revoked_at)
    VALUES (?, ?, ?, ?, NULL)
  `).run(String(token), String(userId), Date.now(), Number(expiresAt));
}

function revokeRefreshToken(token) {
  db.prepare(`
    UPDATE refresh_tokens
    SET revoked_at = ?
    WHERE token = ? AND revoked_at IS NULL
  `).run(Date.now(), String(token));
}

function revokeAllRefreshTokensForUser(userId) {
  db.prepare(`
    UPDATE refresh_tokens
    SET revoked_at = ?
    WHERE user_id = ? AND revoked_at IS NULL
  `).run(Date.now(), String(userId));
}

function getRefreshTokenRecord(token) {
  return db
    .prepare(
      `
      SELECT token, user_id as userId, expires_at as expiresAt, revoked_at as revokedAt
      FROM refresh_tokens
      WHERE token = ?
    `
    )
    .get(String(token));
}

function deleteExpiredRefreshTokens() {
  db.prepare(`
    DELETE FROM refresh_tokens
    WHERE expires_at < ? OR revoked_at IS NOT NULL
  `).run(Date.now());
}

// OTP (DB)
function upsertOtp({ email, codeHash, expiresAt, username, passHash }) {
  db.prepare(`
    INSERT INTO otp_codes (email, code_hash, expires_at, username, pass_hash)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(email) DO UPDATE SET
      code_hash=excluded.code_hash,
      expires_at=excluded.expires_at,
      username=excluded.username,
      pass_hash=excluded.pass_hash
  `).run(
    normalizeEmail(email),
    String(codeHash),
    Number(expiresAt),
    normalizeUsername(username),
    String(passHash)
  );
}

function getOtp(email) {
  return db
    .prepare(`
      SELECT email, code_hash as codeHash, expires_at as expiresAt, username, pass_hash as passHash
      FROM otp_codes
      WHERE email = ?
    `)
    .get(normalizeEmail(email));
}

function deleteOtp(email) {
  db.prepare(`DELETE FROM otp_codes WHERE email = ?`).run(normalizeEmail(email));
}

function deleteExpiredOtps() {
  db.prepare(`DELETE FROM otp_codes WHERE expires_at < ?`).run(Date.now());
}

// MESSAGES
function addMessage({ id, room, clientId, username, text, system, createdAt }) {
  db.prepare(`
    INSERT INTO messages (id, room, client_id, username, text, system, created_at)
    VALUES (@id, @room, @client_id, @username, @text, @system, @created_at)
  `).run({
    id: String(id),
    room: String(room),
    client_id: clientId ? String(clientId) : null,
    username: username ?? null,
    text: String(text),
    system: system ? 1 : 0,
    created_at: typeof createdAt === "number" ? createdAt : Date.now(),
  });
}

function getRecentMessages(room, limit = 50) {
  const rows = db
    .prepare(
      `
      SELECT id, room, client_id as clientId, username, text, system, created_at as createdAt
      FROM messages
      WHERE room = ?
      ORDER BY created_at DESC
      LIMIT ?
    `
    )
    .all(String(room), Number(limit));

  return rows.reverse();
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
};
