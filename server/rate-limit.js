"use strict";

const crypto = require("node:crypto");
const { requiredSessionSecret } = require("./auth.js");
const { databaseError, getSql } = require("./db.js");
const { HttpError, headerValue } = require("./http.js");

const MAX_ATTEMPTS = 8;
const WINDOW_MINUTES = 15;
const BLOCK_MINUTES = 15;

function requestIdentity(request) {
  const forwarded = headerValue(request, "x-forwarded-for").split(",", 1)[0].trim();
  return forwarded || request.socket?.remoteAddress || "unknown";
}

function identityHash(request) {
  return crypto.createHmac("sha256", requiredSessionSecret())
    .update(requestIdentity(request), "utf8")
    .digest("hex");
}

async function assertLoginAllowed(request) {
  try {
    const sql = getSql();
    const keyHash = identityHash(request);
    const rows = await sql`
      SELECT blocked_until AS "blockedUntil"
      FROM login_rate_limits
      WHERE key_hash = ${keyHash}
    `;
    const blockedUntil = rows[0]?.blockedUntil;
    if (blockedUntil && new Date(blockedUntil).getTime() > Date.now()) {
      throw new HttpError(429, "login_rate_limited", "محاولات الدخول كثيرة. حاول بعد 15 دقيقة.");
    }
    return keyHash;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw databaseError(error);
  }
}

async function recordLoginFailure(keyHash) {
  try {
    const sql = getSql();
    await sql`
      INSERT INTO login_rate_limits (key_hash, attempts, window_started_at, blocked_until, updated_at)
      VALUES (${keyHash}, 1, NOW(), NULL, NOW())
      ON CONFLICT (key_hash) DO UPDATE SET
        attempts = CASE
          WHEN login_rate_limits.window_started_at < NOW() - INTERVAL '15 minutes' THEN 1
          ELSE login_rate_limits.attempts + 1
        END,
        window_started_at = CASE
          WHEN login_rate_limits.window_started_at < NOW() - INTERVAL '15 minutes' THEN NOW()
          ELSE login_rate_limits.window_started_at
        END,
        blocked_until = CASE
          WHEN (CASE
            WHEN login_rate_limits.window_started_at < NOW() - INTERVAL '15 minutes' THEN 1
            ELSE login_rate_limits.attempts + 1
          END) >= ${MAX_ATTEMPTS}
          THEN NOW() + INTERVAL '15 minutes'
          ELSE NULL
        END,
        updated_at = NOW()
    `;
  } catch (error) {
    throw databaseError(error);
  }
}

async function clearLoginFailures(keyHash) {
  try {
    const sql = getSql();
    await sql`DELETE FROM login_rate_limits WHERE key_hash = ${keyHash}`;
  } catch (error) {
    throw databaseError(error);
  }
}

module.exports = {
  BLOCK_MINUTES,
  MAX_ATTEMPTS,
  WINDOW_MINUTES,
  assertLoginAllowed,
  clearLoginFailures,
  identityHash,
  recordLoginFailure,
};
