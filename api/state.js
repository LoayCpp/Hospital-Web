"use strict";

const { requireAuth } = require("../server/auth.js");
const { getState, updateState } = require("../server/db.js");
const {
  assertSameOrigin,
  handleError,
  readJson,
  sendJson,
  sendMethodNotAllowed,
} = require("../server/http.js");
const { STATE_MAX_BYTES, assertStateUpdatePayload } = require("../server/validate.js");

const STATE_REQUEST_LIMIT = STATE_MAX_BYTES + 4 * 1024;

module.exports = async function state(request, response) {
  const method = String(request.method || "").toUpperCase();
  if (method !== "GET" && method !== "PUT") {
    return sendMethodNotAllowed(response, ["GET", "PUT"]);
  }

  try {
    requireAuth(request);
    response.setHeader("Vary", "Cookie");

    if (method === "GET") {
      return sendJson(response, 200, await getState());
    }

    assertSameOrigin(request);
    const { data, revision } = assertStateUpdatePayload(
      await readJson(request, { limit: STATE_REQUEST_LIMIT }),
    );
    const result = await updateState(data, revision);
    if (!result.updated) {
      return sendJson(response, 409, {
        code: "revision_conflict",
        message: "تم تعديل البيانات من جلسة أخرى. أُعيدت أحدث نسخة.",
        data: result.state.data,
        revision: result.state.revision,
        updatedAt: result.state.updatedAt,
      });
    }
    return sendJson(response, 200, {
      revision: result.state.revision,
      updatedAt: result.state.updatedAt,
    });
  } catch (error) {
    return handleError(response, error);
  }
};
