const test = require("node:test");
const assert = require("node:assert/strict");
const R = require("../src/rules.js");

const memory = new Map();
global.localStorage = {
  getItem: (key) => memory.has(key) ? memory.get(key) : null,
  setItem: (key, value) => memory.set(key, String(value)),
  removeItem: (key) => memory.delete(key),
};
global.window = { HCTRules: R };
require("../src/storage.js");
const S = global.window.HCTStorage;

test("الرصيد الختامي ينتقل إلى اليوم التالي", () => {
  const data = S.defaults();
  S.saveRecord(data, "2026-09-01", "h1", { balanceAdjustment: 5, newCases: 2, exits: 1, updated: 4, receivedAt: "09:00" });
  assert.equal(S.recordFor(data, "2026-09-01", "h1").closing, 6);
  assert.equal(S.recordFor(data, "2026-09-02", "h1").carried, 6);
  assert.equal(S.recordFor(data, "2026-09-02", "h1").required, 6);
  assert.equal(S.recordFor(data, "2026-09-03", "h1").carried, 6);
});

test("البيانات الابتدائية تطابق السجل المرجعي وتُرحّل الرصيد عبر كل الأيام", () => {
  const data = S.defaults();
  assert.equal(Object.keys(data.records).length, 110);
  assert.equal(S.recordFor(data, "2026-09-01", "h1").closing, 3);
  assert.equal(S.recordFor(data, "2026-09-04", "h1").closing, 4);
  assert.equal(S.recordFor(data, "2026-09-10", "h1").closing, 4);
  assert.equal(S.recordFor(data, "2026-09-10", "h1").required, 4);
  assert.equal(S.recordFor(data, "2026-09-10", "h2").status, "zero");
});

test("النسخة الاحتياطية تحفظ البيانات والإعدادات وتستعيدها", () => {
  const data = S.defaults();
  S.saveRecord(data, "2026-09-01", "h1", { updated: 0, receivedAt: "09:00" });
  const backup = S.exportBackup(data);
  const restored = S.importBackup(backup);
  assert.equal(restored.hospitals.length, 11);
  assert.equal(restored.records["2026-09-01::h1"].receivedAt, "09:00");
  assert.equal(restored.settings.weights.report, 40);
});
