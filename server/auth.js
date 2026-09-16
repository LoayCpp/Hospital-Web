"use strict";

const crypto = require("node:crypto");
const { HttpError, headerValue } = require("./http.js");

const HOST_COOKIE_NAME = "__Host-qassim_session";
const LOCAL_COOKIE_NAME = "qassim_session";
const SESSION_TTL_SECONDS = 12 * 60 * 60;
const MIN_SESSION_SECRET_LENGTH = 32;
const MIN_PASSWORD_LENGTH = 8;

function requiredSessionSecret() {
  const secret = process.env.SESSION_SECRET;
  if (typeof secret !== "string" || secret.length < MIN_SESSION_SECRET_LENGTH) {
    throw new HttpError(
      500,
      "server_misconfigured",
      `إعداد SESSION_SECRET مفقود أو أقصر من ${MIN_SESSION_SECRET_LENGTH} حرفًا.`,
    );
  }
  return secret;
}

function requiredAppPassword() {
  const password = process.env.APP_PASSWORD;
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    throw new HttpError(
      500,
      "server_misconfigured",
      `إعداد APP_PASSWORD مفقود أو أقصر من ${MIN_PASSWORD_LENGTH} أحرف.`,
    );
  }
  return password;
}

function safeEqualText(left, right) {
  const leftDigest = crypto.createHash("sha256").update(String(left), "utf8").digest();
  const rightDigest = crypto.createHash("sha256").update(String(right), "utf8").digest();
  return crypto.timingSafeEqual(leftDigest, rightDigest);
}

function signPayload(encodedPayload, secret) {
  return crypto.createHmac("sha256", secret).update(encodedPayload, "ascii").digest("base64url");
}

function createSessionToken(nowSeconds = Math.floor(Date.now() / 1000)) {
  const secret = requiredSessionSecret();
  const payload = {
    v: 1,
    iat: nowSeconds,
    exp: nowSeconds + SESSION_TTL_SECONDS,
    nonce: crypto.randomBytes(16).toString("base64url"),
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${encodedPayload}.${signPayload(encodedPayload, secret)}`;
}

function verifySessionToken(token, nowSeconds = Math.floor(Date.now() / 1000)) {
  const secret = requiredSessionSecret();
  if (typeof token !== "string" || token.length > 2048) return false;

  const parts = token.split(".");
  if (parts.length !== 2 || !parts.every((part) => /^[A-Za-z0-9_-]+$/.test(part))) return false;
  const [encodedPayload, suppliedSignature] = parts;
  const expectedSignature = signPayload(encodedPayload, secret);
  if (!safeEqualText(suppliedSignature, expectedSignature)) return false;

  let payload;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  } catch (_) {
    return false;
  }

  if (!payload || payload.v !== 1) return false;
  if (!Number.isSafeInteger(payload.iat) || !Number.isSafeInteger(payload.exp)) return false;
  if (typeof payload.nonce !== "string" || payload.nonce.length < 16) return false;
  if (payload.iat > nowSeconds + 60 || payload.exp <= nowSeconds) return false;
  if (payload.exp <= payload.iat || payload.exp - payload.iat > SESSION_TTL_SECONDS) return false;
  return true;
}

function parseCookies(request) {
  const cookies = Object.create(null);
  for (const part of headerValue(request, "cookie").split(";")) {
    const separator = part.indexOf("=");
    if (separator <= 0) continue;
    const name = part.slice(0, separator).trim();
    if (!name || Object.hasOwn(cookies, name)) continue;
    cookies[name] = part.slice(separator + 1).trim();
  }
  return cookies;
}

function requestUsesHttps(request) {
  const forwarded = headerValue(request, "x-forwarded-proto").split(",", 1)[0].trim();
  return forwarded === "https" || Boolean(request.socket?.encrypted) || process.env.VERCEL === "1";
}

function appendSetCookie(response, cookie) {
  const existing = typeof response.getHeader === "function" ? response.getHeader("Set-Cookie") : undefined;
  if (!existing) response.setHeader("Set-Cookie", cookie);
  else if (Array.isArray(existing)) response.setHeader("Set-Cookie", [...existing, cookie]);
  else response.setHeader("Set-Cookie", [existing, cookie]);
}

function cookieAttributes(request, maxAge) {
  const attributes = [
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${maxAge}`,
  ];
  if (requestUsesHttps(request)) attributes.push("Secure");
  return attributes.join("; ");
}

function setSessionCookie(request, response, token) {
  const name = requestUsesHttps(request) ? HOST_COOKIE_NAME : LOCAL_COOKIE_NAME;
  appendSetCookie(response, `${name}=${token}; ${cookieAttributes(request, SESSION_TTL_SECONDS)}`);
}

function clearSessionCookies(request, response) {
  const expired = "Expires=Thu, 01 Jan 1970 00:00:00 GMT";
  appendSetCookie(response, `${HOST_COOKIE_NAME}=; ${cookieAttributes({ ...request, headers: { ...(request.headers || {}), "x-forwarded-proto": "https" } }, 0)}; ${expired}`);
  appendSetCookie(response, `${LOCAL_COOKIE_NAME}=; ${cookieAttributes(request, 0)}; ${expired}`);
}

function requireAuth(request) {
  const cookies = parseCookies(request);
  const candidates = [cookies[HOST_COOKIE_NAME], cookies[LOCAL_COOKIE_NAME]].filter(Boolean);
  if (!candidates.some((token) => verifySessionToken(token))) {
    throw new HttpError(401, "auth_required", "يلزم تسجيل الدخول للوصول إلى البيانات.");
  }
}

module.exports = {
  HOST_COOKIE_NAME,
  LOCAL_COOKIE_NAME,
  MIN_PASSWORD_LENGTH,
  MIN_SESSION_SECRET_LENGTH,
  SESSION_TTL_SECONDS,
  clearSessionCookies,
  createSessionToken,
  parseCookies,
  requireAuth,
  requiredAppPassword,
  requiredSessionSecret,
  safeEqualText,
  setSessionCookie,
  verifySessionToken,
};
