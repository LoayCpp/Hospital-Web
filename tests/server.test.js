const test = require("node:test");
const assert = require("node:assert/strict");
const R = require("../src/rules.js");

const {
  HOST_COOKIE_NAME,
  createSessionToken,
  verifySessionToken,
} = require("../server/auth.js");
const { HttpError, assertSameOrigin, readJson } = require("../server/http.js");
const {
  STATE_MAX_BYTES,
  assertLoginPayload,
  assertStateUpdatePayload,
} = require("../server/validate.js");

function withEnvironment(values, callback) {
  const original = {};
  const restore = () => {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
  for (const [key, value] of Object.entries(values)) {
    original[key] = process.env[key];
    process.env[key] = value;
  }
  try {
    const result = callback();
    if (result && typeof result.then === "function") return result.finally(restore);
    restore();
    return result;
  } catch (error) {
    restore();
    throw error;
  }
}

function mockResponse() {
  const headers = new Map();
  return {
    headers,
    headersSent: false,
    statusCode: 0,
    body: "",
    setHeader(name, value) { headers.set(name.toLowerCase(), value); },
    getHeader(name) { return headers.get(name.toLowerCase()); },
    end(value = "") { this.body += value; this.headersSent = true; this.writableEnded = true; },
  };
}

function validState() {
  return {
    version: 2,
    settings: JSON.parse(JSON.stringify(R.DEFAULT_SETTINGS)),
    hospitals: [{ id: "h1", name: "مستشفى الاختبار", coordinator: "", phone: "", active: true }],
    records: {},
    reminders: {},
    lastDate: "2026-09-16",
  };
}

test("رمز الجلسة الموقّع صالح ضمن مدته ويرفض العبث والانتهاء", () => {
  withEnvironment({ SESSION_SECRET: "s".repeat(48) }, () => {
    const now = 1_700_000_000;
    const token = createSessionToken(now);
    assert.equal(verifySessionToken(token, now + 60), true);
    assert.equal(verifySessionToken(`${token.slice(0, -1)}x`, now + 60), false);
    assert.equal(verifySessionToken(token, now + (12 * 60 * 60)), false);
  });
});

test("التحقق يقبل حالة JSON سليمة ويرفض رقم مراجعة غير صالح", () => {
  const state = validState();
  assert.deepEqual(assertStateUpdatePayload({ data: state, revision: 0 }), { data: state, revision: 0 });
  assert.throws(
    () => assertStateUpdatePayload({ data: state, revision: -1 }),
    (error) => error instanceof HttpError && error.code === "invalid_revision",
  );
});

test("التحقق يرفض كائنات الحالة الكبيرة أو شديدة التداخل", () => {
  assert.throws(
    () => assertStateUpdatePayload({ data: { notes: "أ".repeat(STATE_MAX_BYTES) }, revision: 0 }),
    (error) => error.code === "state_too_large",
  );

  const data = {};
  let cursor = data;
  for (let index = 0; index < 42; index += 1) {
    cursor.next = {};
    cursor = cursor.next;
  }
  assert.throws(
    () => assertStateUpdatePayload({ data, revision: 0 }),
    (error) => error.code === "state_too_deep",
  );
});

test("التحقق يرفض مفاتيح قد تسبب تلويث prototype", () => {
  const data = JSON.parse('{"__proto__":{"admin":true}}');
  assert.throws(
    () => assertStateUpdatePayload({ data, revision: 0 }),
    (error) => error.code === "unsafe_state_key",
  );
});

test("قراءة JSON تحترم نوع المحتوى وحد الحجم", async () => {
  const parsed = await readJson({
    headers: { "content-type": "application/json" },
    body: '{"password":"abcdefgh"}',
  }, { limit: 100 });
  assert.equal(assertLoginPayload(parsed), "abcdefgh");

  await assert.rejects(
    () => readJson({ headers: { "content-type": "text/plain" }, body: "{}" }),
    (error) => error.code === "unsupported_media_type",
  );
});

test("الطلبات المعدّلة ترفض Origin مختلفًا", () => {
  assert.doesNotThrow(() => assertSameOrigin({
    headers: { origin: "https://example.com", host: "example.com", "x-forwarded-proto": "https" },
  }));
  assert.throws(
    () => assertSameOrigin({
      headers: { origin: "https://evil.example", host: "example.com", "x-forwarded-proto": "https" },
    }),
    (error) => error.code === "invalid_origin",
  );
});

test("تسجيل الدخول يضع Cookie آمنة ولا يعيد كلمة المرور", async () => {
  await withEnvironment({
    APP_PASSWORD: "correct-password",
    SESSION_SECRET: "k".repeat(48),
  }, async () => {
    const rateLimitPath = require.resolve("../server/rate-limit.js");
    const loginPath = require.resolve("../api/login.js");
    const originalRateLimit = require.cache[rateLimitPath];
    require.cache[rateLimitPath] = {
      id: rateLimitPath,
      filename: rateLimitPath,
      loaded: true,
      exports: {
        assertLoginAllowed: async () => "test-key",
        clearLoginFailures: async () => {},
        recordLoginFailure: async () => {},
      },
    };
    delete require.cache[loginPath];
    const login = require(loginPath);
    const response = mockResponse();
    try {
      await login({
        method: "POST",
        headers: {
          "content-type": "application/json",
          host: "example.com",
          origin: "https://example.com",
          "x-forwarded-proto": "https",
        },
        body: { password: "correct-password" },
      }, response);

      assert.equal(response.statusCode, 200);
      const cookie = response.getHeader("set-cookie");
      assert.match(cookie, new RegExp(`^${HOST_COOKIE_NAME}=`));
      assert.match(cookie, /HttpOnly/);
      assert.match(cookie, /SameSite=Strict/);
      assert.match(cookie, /Secure/);
      assert.equal(response.body.includes("correct-password"), false);
    } finally {
      delete require.cache[loginPath];
      if (originalRateLimit) require.cache[rateLimitPath] = originalRateLimit;
      else delete require.cache[rateLimitPath];
    }
  });
});

test("واجهة الحالة ترفض الطلب غير المسجل قبل محاولة الاتصال بقاعدة البيانات", async () => {
  await withEnvironment({ SESSION_SECRET: "z".repeat(48) }, async () => {
    const state = require("../api/state.js");
    const response = mockResponse();
    await state({ method: "GET", headers: {} }, response);
    assert.equal(response.statusCode, 401);
    assert.equal(JSON.parse(response.body).code, "auth_required");
    assert.equal(response.getHeader("cache-control"), "no-store, max-age=0");
  });
});
