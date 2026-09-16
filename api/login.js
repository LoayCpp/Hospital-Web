"use strict";

const {
  createSessionToken,
  requiredAppPassword,
  safeEqualText,
  setSessionCookie,
} = require("../server/auth.js");
const {
  HttpError,
  assertSameOrigin,
  handleError,
  readJson,
  sendJson,
  sendMethodNotAllowed,
} = require("../server/http.js");
const { assertLoginPayload } = require("../server/validate.js");
const {
  assertLoginAllowed,
  clearLoginFailures,
  recordLoginFailure,
} = require("../server/rate-limit.js");

const LOGIN_BODY_LIMIT = 4 * 1024;

module.exports = async function login(request, response) {
  if (String(request.method || "").toUpperCase() !== "POST") {
    return sendMethodNotAllowed(response, ["POST"]);
  }

  try {
    assertSameOrigin(request);
    const password = assertLoginPayload(await readJson(request, { limit: LOGIN_BODY_LIMIT }));
    const expectedPassword = requiredAppPassword();
    const rateLimitKey = await assertLoginAllowed(request);
    if (!safeEqualText(password, expectedPassword)) {
      await recordLoginFailure(rateLimitKey);
      throw new HttpError(401, "invalid_credentials", "كلمة المرور غير صحيحة.");
    }

    await clearLoginFailures(rateLimitKey);
    setSessionCookie(request, response, createSessionToken());
    return sendJson(response, 200, { ok: true });
  } catch (error) {
    return handleError(response, error);
  }
};
