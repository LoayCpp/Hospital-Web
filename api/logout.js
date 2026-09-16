"use strict";

const { clearSessionCookies } = require("../server/auth.js");
const {
  assertSameOrigin,
  handleError,
  sendJson,
  sendMethodNotAllowed,
} = require("../server/http.js");

module.exports = async function logout(request, response) {
  if (String(request.method || "").toUpperCase() !== "POST") {
    return sendMethodNotAllowed(response, ["POST"]);
  }

  try {
    assertSameOrigin(request);
    clearSessionCookies(request, response);
    return sendJson(response, 200, { ok: true });
  } catch (error) {
    return handleError(response, error);
  }
};
