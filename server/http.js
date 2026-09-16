"use strict";

const DEFAULT_JSON_LIMIT = 64 * 1024;

class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

function headerValue(request, name) {
  if (!request) return "";
  if (typeof request.get === "function") {
    const value = request.get(name);
    if (value !== undefined && value !== null) return String(value);
  }
  const headers = request.headers || {};
  const lowerName = name.toLowerCase();
  const value = headers[lowerName] ?? headers[name];
  if (Array.isArray(value)) return value[0] || "";
  return value === undefined || value === null ? "" : String(value);
}

function firstForwardedValue(value) {
  return String(value || "").split(",", 1)[0].trim();
}

function applyApiHeaders(response) {
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store, max-age=0");
  response.setHeader("Pragma", "no-cache");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
}

function sendJson(response, status, payload, extraHeaders = {}) {
  applyApiHeaders(response);
  Object.entries(extraHeaders).forEach(([name, value]) => response.setHeader(name, value));
  response.statusCode = status;
  response.end(JSON.stringify(payload));
}

function sendMethodNotAllowed(response, allowedMethods) {
  return sendJson(response, 405, {
    code: "method_not_allowed",
    message: "طريقة الطلب غير مسموحة.",
  }, { Allow: allowedMethods.join(", ") });
}

function assertSameOrigin(request) {
  const fetchSite = headerValue(request, "sec-fetch-site").toLowerCase();
  if (fetchSite === "cross-site") {
    throw new HttpError(403, "cross_site_request", "تم رفض طلب صادر من موقع آخر.");
  }

  const origin = headerValue(request, "origin");
  if (!origin) return;

  const host = firstForwardedValue(
    headerValue(request, "x-forwarded-host") || headerValue(request, "host"),
  );
  const protocol = firstForwardedValue(headerValue(request, "x-forwarded-proto"))
    || (request.socket?.encrypted ? "https" : "http");

  let parsedOrigin;
  try {
    parsedOrigin = new URL(origin);
  } catch (_) {
    throw new HttpError(403, "invalid_origin", "مصدر الطلب غير صالح.");
  }

  if (!host || parsedOrigin.origin !== `${protocol}://${host}`) {
    throw new HttpError(403, "invalid_origin", "تم رفض الطلب لأن مصدره لا يطابق الموقع.");
  }
}

function assertJsonContentType(request) {
  const contentType = headerValue(request, "content-type");
  if (!contentType) return;
  const mediaType = contentType.split(";", 1)[0].trim().toLowerCase();
  if (mediaType !== "application/json" && !mediaType.endsWith("+json")) {
    throw new HttpError(415, "unsupported_media_type", "يجب إرسال الطلب بصيغة JSON.");
  }
}

function byteLengthOfJson(value) {
  let serialized;
  try {
    serialized = JSON.stringify(value);
  } catch (_) {
    throw new HttpError(400, "invalid_json", "تعذّر قراءة بيانات JSON.");
  }
  if (serialized === undefined) {
    throw new HttpError(400, "invalid_json", "محتوى الطلب فارغ أو غير صالح.");
  }
  return Buffer.byteLength(serialized, "utf8");
}

async function readJson(request, options = {}) {
  const limit = options.limit || DEFAULT_JSON_LIMIT;
  assertJsonContentType(request);

  const declaredLength = Number.parseInt(headerValue(request, "content-length"), 10);
  if (Number.isFinite(declaredLength) && declaredLength > limit) {
    throw new HttpError(413, "payload_too_large", "حجم الطلب أكبر من الحد المسموح.");
  }

  if (request.body !== undefined && request.body !== null) {
    if (typeof request.body === "object" && !Buffer.isBuffer(request.body)) {
      if (byteLengthOfJson(request.body) > limit) {
        throw new HttpError(413, "payload_too_large", "حجم الطلب أكبر من الحد المسموح.");
      }
      return request.body;
    }

    const rawBody = Buffer.isBuffer(request.body)
      ? request.body
      : Buffer.from(String(request.body), "utf8");
    if (rawBody.length > limit) {
      throw new HttpError(413, "payload_too_large", "حجم الطلب أكبر من الحد المسموح.");
    }
    return parseJsonBuffer(rawBody);
  }

  if (!request || typeof request[Symbol.asyncIterator] !== "function") {
    throw new HttpError(400, "empty_body", "محتوى الطلب مطلوب.");
  }

  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > limit) {
      throw new HttpError(413, "payload_too_large", "حجم الطلب أكبر من الحد المسموح.");
    }
    chunks.push(buffer);
  }
  return parseJsonBuffer(Buffer.concat(chunks, total));
}

function parseJsonBuffer(buffer) {
  if (!buffer.length) throw new HttpError(400, "empty_body", "محتوى الطلب مطلوب.");
  try {
    return JSON.parse(buffer.toString("utf8"));
  } catch (_) {
    throw new HttpError(400, "invalid_json", "صيغة JSON غير صالحة.");
  }
}

function handleError(response, error) {
  if (response.headersSent) {
    if (!response.writableEnded) response.end();
    return;
  }

  if (error instanceof HttpError) {
    const payload = { code: error.code, message: error.message };
    if (error.details !== undefined) payload.details = error.details;
    sendJson(response, error.status, payload);
    return;
  }

  console.error("خطأ غير متوقع في API:", error);
  sendJson(response, 500, {
    code: "internal_error",
    message: "حدث خطأ داخلي غير متوقع.",
  });
}

module.exports = {
  DEFAULT_JSON_LIMIT,
  HttpError,
  applyApiHeaders,
  assertSameOrigin,
  handleError,
  headerValue,
  readJson,
  sendJson,
  sendMethodNotAllowed,
};
