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
    read_at INTEGER,
    attachment_url TEXT,
    attachment_name TEXT,
    attachment_type TEXT,
    attachment_size INTEGER
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

  -- OTP (persist; survives restart)
  CREATE TABLE IF NOT EXISTS otp_codes (
    email TEXT PRIMARY KEY,
    code_hash TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    username TEXT NOT NULL,
    pass_hash TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_otp_expires ON otp_codes(expires_at);

  -- CALL HISTORY: one row per call session (1:1 or group); participants live
  -- in call_history_participants so a session can have any number of them.
  CREATE TABLE IF NOT EXISTS call_history (
    id TEXT PRIMARY KEY,
    room TEXT,
    starter TEXT NOT NULL,
    call_type TEXT NOT NULL DEFAULT 'audio',
    status TEXT NOT NULL DEFAULT 'ringing',
    started_at INTEGER NOT NULL,
    ended_at INTEGER
  );

  CREATE INDEX IF NOT EXISTS idx_call_history_room ON call_history(room, started_at DESC);

  CREATE TABLE IF NOT EXISTS call_history_participants (
    call_id TEXT NOT NULL,
    username TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'invitee',
    status TEXT NOT NULL DEFAULT 'ringing',
    rang_at INTEGER,
    joined_at INTEGER,
    left_at INTEGER,
    PRIMARY KEY (call_id, username)
  );

  CREATE INDEX IF NOT EXISTS idx_chp_call ON call_history_participants(call_id);
  CREATE INDEX IF NOT EXISTS idx_chp_user ON call_history_participants(username);

  -- STICKERS: personal per-user sticker tray
  CREATE TABLE IF NOT EXISTS stickers (
    id TEXT PRIMARY KEY,
    owner_username TEXT NOT NULL,
    url TEXT NOT NULL,
    name TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_stickers_owner ON stickers(owner_username, created_at DESC);

  -- PUSH SUBSCRIPTIONS: a user can have several (one per browser/device)
  CREATE TABLE IF NOT EXISTS push_subscriptions (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_push_subs_username ON push_subscriptions(username);
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
  ensureColumn("messages", "attachment_url", "TEXT");
  ensureColumn("messages", "attachment_name", "TEXT");
  ensureColumn("messages", "attachment_type", "TEXT");
  ensureColumn("messages", "attachment_size", "INTEGER");
  ensureColumn("messages", "type", "TEXT DEFAULT 'text'");
  ensureColumn("messages", "voice_url", "TEXT");
  ensureColumn("messages", "delivered_at", "INTEGER");

  db.exec(`
    CREATE TABLE IF NOT EXISTS deleted_messages (
      user_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      PRIMARY KEY (user_id, message_id)
    );
  `);

  migrateCallHistoryToSessions();
} catch (e) {
  console.log("❌ Migration error:", e?.message || e);
}

// One-time rebuild: the original call_history was 1:1-only (fixed
// caller/callee columns, both NOT NULL — can't be relaxed with a plain
// ALTER TABLE). Group calls need N participants per session, so old rows
// are migrated into the new starter-only call_history plus a
// call_history_participants row per side, preserving history.
function migrateCallHistoryToSessions() {
  const cols = db.prepare(`PRAGMA table_info(call_history)`).all();
  const hasStarter = cols.some((c) => c.name === "starter");
  const hasCaller = cols.some((c) => c.name === "caller");
  if (hasStarter || !hasCaller) return; // already migrated, or fresh DB

  const rebuild = db.transaction(() => {
    db.exec(`
      CREATE TABLE call_history_new (
        id TEXT PRIMARY KEY,
        room TEXT,
        starter TEXT NOT NULL,
        call_type TEXT NOT NULL DEFAULT 'audio',
        status TEXT NOT NULL DEFAULT 'ringing',
        started_at INTEGER NOT NULL,
        ended_at INTEGER
      );
    `);

    db.exec(`
      INSERT INTO call_history_new (id, room, starter, call_type, status, started_at, ended_at)
      SELECT id, room, caller, call_type, status, started_at, ended_at FROM call_history;
    `);

    db.exec(`
      INSERT OR IGNORE INTO call_history_participants
        (call_id, username, role, status, rang_at, joined_at, left_at)
      SELECT id, caller, 'starter', 'left', started_at, started_at, ended_at
      FROM call_history;
    `);

    db.exec(`
      INSERT OR IGNORE INTO call_history_participants
        (call_id, username, role, status, rang_at, joined_at, left_at)
      SELECT id, callee, 'invitee',
             CASE status
               WHEN 'rejected' THEN 'declined'
               WHEN 'unavailable' THEN 'unavailable'
               WHEN 'busy' THEN 'unavailable'
               ELSE 'left'
             END,
             started_at,
             CASE WHEN status IN ('accepted', 'ended') THEN answered_at ELSE NULL END,
             ended_at
      FROM call_history;
    `);

    db.exec(`DROP TABLE call_history;`);
    db.exec(`ALTER TABLE call_history_new RENAME TO call_history;`);
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_call_history_room ON call_history(room, started_at DESC);`,
    );
  });

  rebuild();
  console.log("✅ Migration: call_history rebuilt for group-call sessions");
}

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

const stmtCreateUser = db.prepare(`
  INSERT INTO users (id, username, email, pass_hash, created_at)
  VALUES (@id, @username, @email, @pass_hash, @created_at)
`);

const stmtFindUserByEmail = db.prepare(
  `SELECT id, username, email, pass_hash as passHash FROM users WHERE email = ?`,
);

const stmtFindUserByUsername = db.prepare(
  `SELECT id, username, email, pass_hash as passHash FROM users WHERE username = ?`,
);

const stmtFindUserById = db.prepare(
  `SELECT id, username, email, pass_hash as passHash FROM users WHERE id = ?`,
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
const stmtDeleteExpiredOtps = db.prepare(
  `DELETE FROM otp_codes WHERE expires_at < ?`,
);

const stmtAddMessage = db.prepare(`
  INSERT INTO messages (id, room, client_id, username, text, system, created_at, reply_to,
                         attachment_url, attachment_name, attachment_type, attachment_size, type, voice_url)
  VALUES (@id, @room, @client_id, @username, @text, @system, @created_at, @reply_to,
          @attachment_url, @attachment_name, @attachment_type, @attachment_size, @type, @voice_url)
`);

const stmtGetRecentMessages = db.prepare(`
  SELECT id, room, client_id as clientId, username, text, system,
         created_at as createdAt, edited_at as editedAt,
         deleted_for_all as deletedForAll, reply_to as replyTo,
         read_at as readAt, delivered_at as deliveredAt,
         attachment_url as attachmentUrl, attachment_name as attachmentName,
         attachment_type as attachmentType, attachment_size as attachmentSize,
         type, voice_url as voiceUrl
  FROM messages
  WHERE room = ?
  ORDER BY created_at DESC
  LIMIT ?
`);

const stmtGetMessageById = db.prepare(`
  SELECT id, room, client_id as clientId, username, text, system,
         created_at as createdAt, edited_at as editedAt,
         deleted_for_all as deletedForAll, reply_to as replyTo,
         read_at as readAt, delivered_at as deliveredAt,
         attachment_url as attachmentUrl, attachment_name as attachmentName,
         attachment_type as attachmentType, attachment_size as attachmentSize,
         type, voice_url as voiceUrl
  FROM messages WHERE id = ?
`);

const stmtGetMessageByClientId = db.prepare(`
  SELECT id, room, client_id as clientId, username, text, system,
         created_at as createdAt, edited_at as editedAt,
         deleted_for_all as deletedForAll, reply_to as replyTo,
         read_at as readAt, delivered_at as deliveredAt,
         attachment_url as attachmentUrl, attachment_name as attachmentName,
         attachment_type as attachmentType, attachment_size as attachmentSize,
         type, voice_url as voiceUrl
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

const stmtMarkDeliveredForRoomExceptUser = db.prepare(`
  UPDATE messages
  SET delivered_at = ?
  WHERE room = ? AND username != ? AND created_at <= ? AND delivered_at IS NULL AND system = 0
`);

const stmtInsertCallSession = db.prepare(`
  INSERT INTO call_history (id, room, starter, call_type, status, started_at, ended_at)
  VALUES (@id, @room, @starter, @call_type, @status, @started_at, @ended_at)
`);

const stmtUpdateCallSessionStatus = db.prepare(`
  UPDATE call_history SET status = ?, ended_at = ? WHERE id = ?
`);

const stmtInsertCallParticipant = db.prepare(`
  INSERT INTO call_history_participants (call_id, username, role, status, rang_at, joined_at, left_at)
  VALUES (@call_id, @username, @role, @status, @rang_at, @joined_at, @left_at)
  ON CONFLICT(call_id, username) DO NOTHING
`);

const stmtUpdateCallParticipantStatus = db.prepare(`
  UPDATE call_history_participants
  SET status = ?, joined_at = COALESCE(?, joined_at), left_at = COALESCE(?, left_at)
  WHERE call_id = ? AND username = ?
`);

const CALL_HISTORY_ROW_SQL = `
  SELECT ch.id, ch.room, ch.starter, ch.call_type as callType, ch.status,
         ch.started_at as startedAt, ch.ended_at as endedAt,
         (
           SELECT json_group_array(json_object(
             'username', chp.username, 'role', chp.role, 'status', chp.status,
             'joinedAt', chp.joined_at, 'leftAt', chp.left_at
           ))
           FROM call_history_participants chp WHERE chp.call_id = ch.id
         ) as participantsJson
  FROM call_history ch
`;

const stmtGetCallHistoryRowById = db.prepare(`${CALL_HISTORY_ROW_SQL} WHERE ch.id = ?`);

const stmtGetCallHistoryForRoom = db.prepare(
  `${CALL_HISTORY_ROW_SQL} WHERE ch.room = ? ORDER BY ch.started_at DESC LIMIT ?`,
);

const stmtGetCallSessionById = db.prepare(`
  SELECT id, room, starter, call_type as callType, status,
         started_at as startedAt, ended_at as endedAt
  FROM call_history WHERE id = ?
`);

const stmtInsertSticker = db.prepare(`
  INSERT INTO stickers (id, owner_username, url, name, created_at)
  VALUES (@id, @owner_username, @url, @name, @created_at)
`);

const stmtGetStickersForUser = db.prepare(`
  SELECT id, owner_username as ownerUsername, url, name, created_at as createdAt
  FROM stickers WHERE owner_username = ? ORDER BY created_at DESC
`);

const stmtDeleteSticker = db.prepare(`
  DELETE FROM stickers WHERE id = ? AND owner_username = ?
`);

const stmtInsertPushSubscription = db.prepare(`
  INSERT INTO push_subscriptions (id, username, endpoint, p256dh, auth, created_at)
  VALUES (@id, @username, @endpoint, @p256dh, @auth, @created_at)
  ON CONFLICT(endpoint) DO UPDATE SET
    username = excluded.username,
    p256dh = excluded.p256dh,
    auth = excluded.auth
`);

const stmtGetPushSubscriptionsForUser = db.prepare(`
  SELECT id, username, endpoint, p256dh, auth, created_at as createdAt
  FROM push_subscriptions WHERE username = ?
`);

const stmtDeletePushSubscriptionByEndpoint = db.prepare(`
  DELETE FROM push_subscriptions WHERE endpoint = ?
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
  stmtStoreRefresh.run(
    String(token),
    String(userId),
    Date.now(),
    Number(expiresAt),
  );
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
    String(passHash),
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

function addMessage({
  id,
  room,
  clientId,
  username,
  text,
  system,
  createdAt,
  replyTo,
  attachment,
  type,
  voiceUrl,
}) {
  stmtAddMessage.run({
    id: String(id),
    room: String(room),
    client_id: clientId ? String(clientId) : null,
    username: username ?? null,
    text: String(text ?? ""),
    system: system ? 1 : 0,
    created_at: typeof createdAt === "number" ? createdAt : Date.now(),
    reply_to: replyTo ? String(replyTo) : null,
    attachment_url: attachment?.url ? String(attachment.url) : null,
    attachment_name: attachment?.name ? String(attachment.name) : null,
    attachment_type: attachment?.type ? String(attachment.type) : null,
    attachment_size:
      typeof attachment?.size === "number" ? attachment.size : null,
    type: type || "text",
    voice_url: voiceUrl || null,
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
  const rows = stmtGetDeletedMessageIdsForUser.all(
    String(userId),
    String(room),
  );
  return new Set(rows.map((r) => r.messageId));
}

function markReadForRoomExceptUser(room, username, readUpToTs) {
  const readAt = Date.now();
  stmtMarkReadForRoomExceptUser.run(
    readAt,
    String(room),
    String(username),
    Number(readUpToTs),
  );
  return readAt;
}

function markDeliveredForRoomExceptUser(room, username, deliveredUpToTs) {
  const deliveredAt = Date.now();
  const result = stmtMarkDeliveredForRoomExceptUser.run(
    deliveredAt,
    String(room),
    String(username),
    Number(deliveredUpToTs),
  );
  return { deliveredAt, changed: result.changes > 0 };
}

function parseCallHistoryRow(row) {
  if (!row) return null;
  const { participantsJson, ...rest } = row;
  return {
    ...rest,
    participants: participantsJson ? JSON.parse(participantsJson) : [],
  };
}

// Creates the session row plus a 'joined' participant row for the starter
// (they're in the call from the moment they create it).
function createCallSession({ id, room, starter, callType }) {
  const now = Date.now();
  stmtInsertCallSession.run({
    id: String(id),
    room: room ? String(room) : null,
    starter: String(starter),
    call_type: callType === "video" ? "video" : "audio",
    status: "ringing",
    started_at: now,
    ended_at: null,
  });
  stmtInsertCallParticipant.run({
    call_id: String(id),
    username: String(starter),
    role: "starter",
    status: "joined",
    rang_at: now,
    joined_at: now,
    left_at: null,
  });
}

function addCallParticipant(callId, username) {
  stmtInsertCallParticipant.run({
    call_id: String(callId),
    username: String(username),
    role: "invitee",
    status: "ringing",
    rang_at: Date.now(),
    joined_at: null,
    left_at: null,
  });
}

function markParticipantJoined(callId, username) {
  const now = Date.now();
  stmtUpdateCallParticipantStatus.run(
    "joined",
    now,
    null,
    String(callId),
    String(username),
  );
  return now;
}

// status: 'declined' | 'left' | 'unavailable' | 'busy' — all terminal for
// that one participant (marks left_at), the session itself may continue.
function markParticipantStatus(callId, username, status) {
  const now = Date.now();
  stmtUpdateCallParticipantStatus.run(
    String(status),
    null,
    now,
    String(callId),
    String(username),
  );
  return now;
}

function markCallSessionStatus(callId, status) {
  const endedAt = Date.now();
  stmtUpdateCallSessionStatus.run(String(status), endedAt, String(callId));
  return endedAt;
}

function getCallSessionById(callId) {
  return stmtGetCallSessionById.get(String(callId));
}

function getCallHistoryRowById(callId) {
  return parseCallHistoryRow(stmtGetCallHistoryRowById.get(String(callId)));
}

function getCallHistoryForRoom(room, limit = 200) {
  return stmtGetCallHistoryForRoom
    .all(String(room), Number(limit))
    .map(parseCallHistoryRow);
}

function addSticker({ id, ownerUsername, url, name }) {
  const createdAt = Date.now();
  stmtInsertSticker.run({
    id: String(id),
    owner_username: String(ownerUsername),
    url: String(url),
    name: name ? String(name) : null,
    created_at: createdAt,
  });
  return {
    id: String(id),
    ownerUsername: String(ownerUsername),
    url: String(url),
    name: name || null,
    createdAt,
  };
}

function getStickersForUser(username) {
  return stmtGetStickersForUser.all(String(username));
}

function deleteSticker(id, ownerUsername) {
  const result = stmtDeleteSticker.run(String(id), String(ownerUsername));
  return result.changes > 0;
}

function addPushSubscription({ id, username, endpoint, p256dh, auth }) {
  stmtInsertPushSubscription.run({
    id: String(id),
    username: String(username),
    endpoint: String(endpoint),
    p256dh: String(p256dh),
    auth: String(auth),
    created_at: Date.now(),
  });
}

function getPushSubscriptionsForUser(username) {
  return stmtGetPushSubscriptionsForUser.all(String(username));
}

function deletePushSubscriptionByEndpoint(endpoint) {
  stmtDeletePushSubscriptionByEndpoint.run(String(endpoint));
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
};