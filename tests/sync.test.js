const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const vm = require("node:vm");

const R = require("../src/rules.js");
const STORAGE_SOURCE = readFileSync(join(__dirname, "../src/storage.js"), "utf8");

function response(status, payload) {
  return {
    status,
    ok: status >= 200 && status < 300,
    async text() {
      return payload === undefined ? "" : JSON.stringify(payload);
    },
  };
}

function createHarness({ memory = new Map(), responses = [] } = {}) {
  const calls = [];
  const timers = new Map();
  let nextTimerId = 1;

  const localStorage = {
    getItem(key) { return memory.has(key) ? memory.get(key) : null; },
    setItem(key, value) { memory.set(key, String(value)); },
    removeItem(key) { memory.delete(key); },
  };

  async function fetch(url, options = {}) {
    calls.push({ url, options });
    if (!responses.length) throw new Error(`Unexpected fetch: ${options.method || "GET"} ${url}`);
    const next = responses.shift();
    if (typeof next === "function") return next(url, options);
    if (next instanceof Error) throw next;
    return next;
  }

  const window = {
    HCTRules: R,
    location: { protocol: "https:" },
  };
  const context = vm.createContext({
    window,
    localStorage,
    fetch,
    setTimeout(callback, delay) {
      const id = nextTimerId++;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
  });
  vm.runInContext(STORAGE_SOURCE, context, { filename: "src/storage.js" });

  return {
    S: window.HCTStorage,
    calls,
    memory,
    responses,
    timers,
  };
}

function stateWithNote(note) {
  return {
    version: 2,
    settings: JSON.parse(JSON.stringify(R.DEFAULT_SETTINGS)),
    hospitals: [{ id: "h1", name: "مستشفى الاختبار", coordinator: "", phone: "", active: true }],
    records: {
      "2026-09-16::h1": {
        newCases: 1,
        exits: 0,
        updated: 0,
        receivedAt: "09:00",
        brainDeath: 0,
        notes: note,
      },
    },
    reminders: {},
    lastDate: "2026-09-16",
  };
}

test("تهيئة Neon الفارغة ترفع حالة ابتدائية بلا سجلات وبالمراجعة صفر", async () => {
  const harness = createHarness({
    responses: [
      response(200, { revision: 0, data: null }),
      response(200, { revision: 1, updatedAt: "2026-09-16T08:00:00.000Z" }),
    ],
  });

  const result = await harness.S.initializeRemote();

  assert.equal(result.status, "remote");
  assert.equal(result.initialized, true);
  assert.equal(Object.keys(result.data.records).length, 0);
  assert.equal(harness.calls.length, 2);
  assert.equal(harness.calls[0].options.method, undefined);
  assert.equal(harness.calls[1].options.method, "PUT");

  const body = JSON.parse(harness.calls[1].options.body);
  assert.equal(body.revision, 0);
  assert.equal(Object.keys(body.data.records).length, 0);
  assert.equal(harness.S.status().revision, 1);
  assert.equal(Object.keys(JSON.parse(harness.memory.get(harness.S.KEY)).records).length, 0);
});

test("الحفظ يرسل PUT باستخدام مراجعة الخادم ثم يعتمد المراجعة الجديدة", async () => {
  const harness = createHarness();
  const remote = harness.S.blankDefaults();
  harness.responses.push(
    response(200, { revision: 7, data: remote }),
    response(200, { revision: 8, updatedAt: "2026-09-16T08:01:00.000Z" }),
  );

  const initialized = await harness.S.initializeRemote();
  initialized.data.records["2026-09-16::h1"] = { notes: "تغيير محلي" };
  harness.S.save(initialized.data);
  await harness.S.flush();

  assert.equal(harness.calls.length, 2);
  assert.equal(harness.calls[1].options.method, "PUT");
  const body = JSON.parse(harness.calls[1].options.body);
  assert.equal(body.revision, 7);
  assert.equal(body.data.records["2026-09-16::h1"].notes, "تغيير محلي");
  assert.deepEqual(
    { ...harness.S.status() },
    { mode: "remote", revision: 8, pending: false },
  );
  assert.equal(harness.memory.has(harness.S.SYNC_KEY), false);
});

test("علامة outbox تبقى في localStorage وتُستعاد بعد إعادة تحميل الوحدة", async () => {
  const memory = new Map();
  const first = createHarness({ memory });
  first.responses.push(response(200, { revision: 4, data: first.S.blankDefaults() }));
  const initialized = await first.S.initializeRemote();

  initialized.data.records["2026-09-16::h1"] = { notes: "بانتظار الرفع" };
  first.S.save(initialized.data);
  assert.equal(JSON.parse(memory.get(first.S.SYNC_KEY)).revision, 4);

  const reloaded = createHarness({
    memory,
    responses: [response(200, { revision: 4, data: first.S.blankDefaults() })],
  });
  const resumed = await reloaded.S.initializeRemote();

  assert.equal(resumed.status, "remote");
  assert.equal(resumed.data.records["2026-09-16::h1"].notes, "بانتظار الرفع");
  assert.equal(reloaded.S.status().mode, "remote");
  assert.equal(reloaded.S.status().pending, true);
  assert.equal(JSON.parse(memory.get(reloaded.S.SYNC_KEY)).revision, 4);
});

test("اختلاف مراجعة outbox عن مراجعة Neon مع اختلاف البيانات ينتج conflict", async () => {
  const local = stateWithNote("نسخة محلية");
  const remote = stateWithNote("نسخة Neon");
  const memory = new Map([
    ["qassim-critical-cases-v1", JSON.stringify(local)],
    ["qassim-critical-cases-sync-v1", JSON.stringify({ revision: 3, savedAt: "2026-09-16T08:00:00.000Z" })],
  ]);
  const harness = createHarness({
    memory,
    responses: [response(200, { revision: 4, data: remote })],
  });

  const result = await harness.S.initializeRemote();

  assert.equal(result.status, "conflict");
  assert.equal(result.data.records["2026-09-16::h1"].notes, "نسخة محلية");
  assert.equal(harness.S.status().mode, "conflict");
  assert.equal(harness.S.status().revision, 4);
  assert.equal(harness.S.status().pending, true);
  assert.equal(JSON.parse(memory.get(harness.S.SYNC_KEY)).revision, 3);
  assert.equal(harness.calls.length, 1);
});

test("اختلاف المراجعة لا يصنع conflict عندما تتطابق النسختان ويزيل outbox", async () => {
  const local = stateWithNote("متطابقة");
  const remote = {
    lastDate: local.lastDate,
    reminders: local.reminders,
    records: local.records,
    hospitals: local.hospitals,
    settings: local.settings,
    version: local.version,
  };
  const memory = new Map([
    ["qassim-critical-cases-v1", JSON.stringify(local)],
    ["qassim-critical-cases-sync-v1", JSON.stringify({ revision: 3, savedAt: "2026-09-16T08:00:00.000Z" })],
  ]);
  const harness = createHarness({
    memory,
    responses: [response(200, { revision: 4, data: remote, updatedAt: "2026-09-16T08:02:00.000Z" })],
  });

  const result = await harness.S.initializeRemote();

  assert.equal(result.status, "remote");
  assert.equal(result.data.records["2026-09-16::h1"].notes, "متطابقة");
  assert.equal(harness.S.status().mode, "remote");
  assert.equal(harness.S.status().revision, 4);
  assert.equal(harness.S.status().pending, false);
  assert.equal(memory.has(harness.S.SYNC_KEY), false);
  assert.equal(harness.calls.length, 1);
});
