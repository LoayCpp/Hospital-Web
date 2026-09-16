const test = require("node:test");
const assert = require("node:assert/strict");
const R = require("../src/rules.js");

const settings = JSON.parse(JSON.stringify(R.DEFAULT_SETTINGS));

test("معامل الوقت كامل حتى 10:00", () => {
  assert.equal(R.timeFactor("09:59", settings), 1);
  assert.equal(R.timeFactor("10:00", settings), 1);
});

test("معامل الوقت ينخفض خطيًا ويصل صفرًا عند 12:00", () => {
  assert.equal(R.timeFactor("11:00", settings), 0.5);
  assert.equal(R.timeFactor("11:30", settings), 0.25);
  assert.equal(R.timeFactor("12:00", settings), 0);
  assert.equal(R.timeFactor("13:00", settings), 0);
});

test("البلاغ الجديد لا يدخل في المطلوب اليوم لكنه يدخل في الختامي", () => {
  const result = R.calculateRecord({ carried: 3, newCases: 2, updated: 3, receivedAt: "09:00" }, settings);
  assert.equal(result.required, 3);
  assert.equal(result.closing, 5);
  assert.equal(result.score, 100);
});

test("الخروج لا يُضاف إلى عدد الحالات المحدثة", () => {
  const result = R.calculateRecord({ carried: 5, exits: 1, updated: 4, receivedAt: "09:00" }, settings);
  assert.equal(result.effectiveUpdated, 4);
  assert.equal(result.completion, 0.8);
  assert.equal(result.closing, 4);
  assert.equal(result.score, 92);
});

test("يمنع احتساب المحدث الفعلي بأكثر من المطلوب", () => {
  const result = R.calculateRecord({ carried: 3, exits: 1, updated: 3, receivedAt: "09:00" }, settings);
  assert.equal(result.effectiveUpdated, 3);
  assert.equal(result.completion, 1);
});

test("الإفادة الصفرية في الوقت تحصل على الدرجة الكاملة", () => {
  const result = R.calculateRecord({ carried: 0, updated: 0, receivedAt: "09:30" }, settings);
  assert.equal(result.status, "zero");
  assert.equal(result.score, 100);
});

test("التحديث الجزئي يحسب 40% تقرير + نسبة الاكتمال + 20% صحة", () => {
  const result = R.calculateRecord({ carried: 4, updated: 2, receivedAt: "09:00" }, settings);
  assert.equal(result.status, "partial");
  assert.equal(result.score, 80);
});

test("الخصم الزمني يضرب الدرجة الخام كاملة", () => {
  const result = R.calculateRecord({ carried: 4, updated: 4, receivedAt: "11:00" }, settings);
  assert.equal(result.status, "late");
  assert.equal(result.rawScore, 100);
  assert.equal(result.score, 50);
});

test("وصول التقرير بعد الموعد يعطي صفرًا", () => {
  const result = R.calculateRecord({ carried: 2, updated: 2, receivedAt: "12:01" }, settings);
  assert.equal(result.status, "afterDeadline");
  assert.equal(result.score, 0);
});

test("غياب الوقت مع وجود بيانات خطأ وصفر", () => {
  const result = R.calculateRecord({ carried: 2, updated: 2 }, settings);
  assert.equal(result.valid, false);
  assert.equal(result.reported, true);
  assert.equal(result.status, "invalid");
  assert.equal(result.score, 0);
  assert.ok(result.errors.includes("وقت الاستلام مطلوب"));
});

test("الصف الفارغ يبقى بانتظار الرد دون إظهار خطأ بيانات", () => {
  const result = R.calculateRecord({}, settings);
  assert.equal(result.valid, false);
  assert.equal(result.reported, false);
  assert.equal(result.status, "pending");
  assert.deepEqual(result.errors, []);
});

test("الصفر الصريح يُعد إفادة بينما الحقول الغائبة لا تُعد إرسالًا", () => {
  assert.equal(R.calculateRecord({ updated: 0 }, settings).reported, true);
  assert.equal(R.calculateRecord({ brainDeath: 0 }, settings).reported, false);
  assert.equal(R.calculateRecord({ notes: "ملاحظة فقط" }, settings).reported, false);
});

test("وقت الموعد النهائي متأخر ودرجته صفر مع الخصم التدريجي", () => {
  const result = R.calculateRecord({ carried: 2, updated: 2, receivedAt: "12:00" }, settings);
  assert.equal(result.status, "late");
  assert.equal(result.score, 0);
});

test("عند إلغاء الخصم التدريجي تبقى الدرجة كاملة حتى الموعد النهائي", () => {
  const custom = JSON.parse(JSON.stringify(settings));
  custom.gradualPenalty = false;
  assert.equal(R.timeFactor("12:00", custom), 1);
  assert.equal(R.timeFactor("12:01", custom), 0);
});

test("الخروج الأكبر من الحالات المتاحة خطأ", () => {
  const result = R.calculateRecord({ carried: 2, exits: 3, receivedAt: "09:00" }, settings);
  assert.equal(result.valid, false);
  assert.equal(result.status, "invalid");
});

test("المحدث الأكبر من المطلوب خطأ", () => {
  const result = R.calculateRecord({ carried: 2, updated: 3, receivedAt: "09:00" }, settings);
  assert.equal(result.valid, false);
  assert.equal(result.status, "invalid");
});

test("تعديل الرصيد يحل محل المرحّل", () => {
  const result = R.calculateRecord({ carried: 8, balanceAdjustment: 5, updated: 5, receivedAt: "09:00" }, settings);
  assert.equal(result.opening, 5);
  assert.equal(result.required, 5);
  assert.equal(result.closing, 5);
});

test("إلغاء عنصر يعيد توزيع الأوزان على العناصر المختارة", () => {
  const custom = JSON.parse(JSON.stringify(settings));
  custom.enabled.accuracy = false;
  const weights = R.normalizeWeights(custom);
  assert.equal(weights.report, 0.5);
  assert.equal(weights.completion, 0.5);
  assert.equal(weights.accuracy, 0);
});

test("عند إلغاء جميع العناصر تعتمد الدرجة على الوقت فقط", () => {
  const custom = JSON.parse(JSON.stringify(settings));
  custom.enabled = { report: false, completion: false, accuracy: false };
  const result = R.calculateRecord({ carried: 4, updated: 0, receivedAt: "09:00" }, custom);
  assert.equal(result.rawScore, 100);
  assert.equal(result.score, 100);
});

test("حدود التقييم والتصعيد", () => {
  assert.equal(R.performanceLabel(80, settings).label, "ممتاز");
  assert.equal(R.performanceLabel(60, settings).label, "مقبول");
  assert.equal(R.performanceLabel(59.9, settings).label, "يحتاج تحسين");
  assert.equal(R.escalation({ missed: 4, late: 0 }, settings), 3);
  assert.equal(R.escalation({ missed: 2, late: 0 }, settings), 2);
  assert.equal(R.escalation({ missed: 1, late: 0 }, settings), 1);
  assert.equal(R.escalation({ missed: 0, late: 0 }, settings), 0);
});

test("اليوم المستقبلي لا يدخل في المؤشر", () => {
  const now = new Date("2026-09-15T09:00:00");
  assert.equal(R.isDueDate("2026-09-16", {}, settings, now), false);
  assert.equal(R.isDueDate("2026-09-14", {}, settings, now), true);
});
