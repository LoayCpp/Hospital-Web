(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.HCTRules = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const DEFAULT_SETTINGS = Object.freeze({
    weights: { report: 40, completion: 40, accuracy: 20 },
    enabled: { report: true, completion: true, accuracy: true },
    fullUntil: "10:00",
    deadline: "12:00",
    gradualPenalty: true,
    startDate: "2026-09-01",
    signature: "منسق التبرع بالأعضاء — تجمع القصيم الصحي",
    whatsappGroup: "",
    excellentAt: 80,
    acceptableAt: 60,
    escalation2Missed: 2,
    escalation2Late: 3,
    escalation3Missed: 4,
    escalation3Late: 6,
    caseLoadBonusEnabled: true,
    maxCaseLoadBonus: 10,
  });

  const DEFAULT_HOSPITALS = Object.freeze([
    "مستشفى الملك فهد التخصصي",
    "مستشفى بريدة المركزي",
    "مستشفى الولادة والأطفال",
    "مستشفى الملك سعود بعنيزة",
    "مستشفى الرس العام",
    "مستشفى المذنب العام",
    "مستشفى البكيرية العام",
    "مستشفى البدائع العام",
    "مستشفى الأسياح العام",
    "مستشفى عيون الجواء العام",
    "مركز الأمير سلطان لجراحة القلب",
  ]);

  function minutes(value) {
    if (!/^\d{1,2}:\d{2}$/.test(String(value || ""))) return null;
    const [h, m] = String(value).split(":").map(Number);
    if (h < 0 || h > 23 || m < 0 || m > 59) return null;
    return h * 60 + m;
  }

  function clamp(n, min, max) { return Math.min(max, Math.max(min, n)); }
  function number(value) {
    if (value === "" || value === null || value === undefined) return 0;
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  function hasValue(value) { return value !== "" && value !== null && value !== undefined; }

  function normalizeWeights(settings) {
    const keys = ["report", "completion", "accuracy"];
    const active = keys.filter((k) => settings.enabled?.[k] !== false);
    const sum = active.reduce((total, k) => total + Math.max(0, number(settings.weights?.[k])), 0);
    return Object.fromEntries(keys.map((k) => [k, active.includes(k) && sum ? Math.max(0, number(settings.weights[k])) / sum : 0]));
  }

  function timeFactor(receivedAt, settings = DEFAULT_SETTINGS) {
    const received = minutes(receivedAt);
    const full = minutes(settings.fullUntil);
    const deadline = minutes(settings.deadline);
    if (received === null || full === null || deadline === null || deadline <= full) return 0;
    if (received <= full) return 1;
    if (received > deadline) return 0;
    if (settings.gradualPenalty === false) return 1;
    return clamp((deadline - received) / (deadline - full), 0, 1);
  }

  function validateRecord(record, required) {
    const errors = [];
    const opening = hasValue(record.balanceAdjustment) ? number(record.balanceAdjustment) : number(record.carried);
    const newCases = number(record.newCases);
    const exits = number(record.exits);
    const updated = number(record.updated);
    const brainDeath = number(record.brainDeath);
    for (const [key, label] of [[opening, "الرصيد"], [newCases, "البلاغات الجديدة"], [exits, "الخروج"], [updated, "المحدث"], [brainDeath, "الوفاة الدماغية"]]) {
      if (key < 0 || !Number.isInteger(key)) errors.push(`${label} يجب أن يكون عددًا صحيحًا غير سالب`);
    }
    const validTime = minutes(record.receivedAt) !== null;
    const reported = [record.newCases, record.exits, record.updated].some(hasValue) || validTime;
    if (reported) {
      if (!validTime) errors.push("وقت الاستلام مطلوب");
      if (required > 0 && !hasValue(record.updated)) errors.push("عدد الحالات المحدثة مطلوب");
      if (exits > opening + newCases) errors.push("الخروج أكبر من الحالات المتاحة");
      if (updated > required) errors.push("المحدث أكبر من المطلوب");
      if (brainDeath > opening + newCases) errors.push("الوفاة الدماغية أكبر من الحالات المتاحة");
    } else if (hasValue(record.receivedAt) && !validTime) {
      errors.push("وقت الاستلام غير صحيح");
    }
    return { valid: reported && errors.length === 0, errors, reported };
  }

  function calculateRecord(input = {}, settings = DEFAULT_SETTINGS) {
    // Empty numeric fields must remain empty here: an explicit zero is a submitted
    // zero report, while an absent field means the hospital has not replied yet.
    const record = { carried: 0, balanceAdjustment: "", newCases: "", exits: "", updated: "", receivedAt: "", brainDeath: "", notes: "", ...input };
    const opening = hasValue(record.balanceAdjustment) ? number(record.balanceAdjustment) : number(record.carried);
    const required = Math.max(0, opening);
    const newCases = Math.max(0, number(record.newCases));
    const exits = Math.max(0, number(record.exits));
    const updated = Math.max(0, number(record.updated));
    const closing = Math.max(0, opening + newCases - exits);
    const check = validateRecord(record, required);
    const effectiveUpdated = check.reported ? Math.min(required, updated) : 0;
    const completion = required === 0 ? 1 : clamp(effectiveUpdated / required, 0, 1);
    const weights = normalizeWeights(settings);
    const components = {
      report: check.reported ? 1 : 0,
      completion,
      accuracy: check.reported && check.valid ? 1 : 0,
    };
    const hasWeightedComponent = Object.values(weights).some((weight) => weight > 0);
    const rawScore = Math.round((hasWeightedComponent ? Object.keys(components).reduce((sum, k) => sum + components[k] * weights[k], 0) : 1) * 100 * 1e6) / 1e6;
    const factor = timeFactor(record.receivedAt, settings);
    const score = check.reported ? Math.round(rawScore * factor * 1e6) / 1e6 : 0;
    let status = "pending";
    if (check.reported && !check.valid) status = "invalid";
    else if (check.reported && minutes(record.receivedAt) > minutes(settings.deadline)) status = "afterDeadline";
    else if (check.reported && minutes(record.receivedAt) > minutes(settings.fullUntil)) status = "late";
    else if (check.reported && completion < 1) status = "partial";
    else if (check.reported && required === 0) status = "zero";
    else if (check.reported) status = "complete";
    return { ...record, opening, required, effectiveUpdated, closing, completion, components, rawScore, timeFactor: factor, score, status, reported: check.reported, valid: check.valid, errors: check.errors };
  }

  function recordKey(date, hospitalId) { return `${date}::${hospitalId}`; }
  function isoDate(date = new Date()) {
    const year = date.getFullYear();
    return `${year}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }
  function daysInMonth(year, month) { return new Date(year, month, 0).getDate(); }
  function addDays(iso, amount) { const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() + amount); return isoDate(d); }
  function addMonths(yearMonth, amount) {
    const match = /^(\d{4})-(\d{2})$/.exec(String(yearMonth || ""));
    if (!match) throw new TypeError("صيغة الشهر يجب أن تكون YYYY-MM");
    const year = Number(match[1]);
    const month = Number(match[2]);
    if (month < 1 || month > 12 || !Number.isInteger(amount)) throw new RangeError("الشهر أو الإزاحة غير صحيحة");
    const absoluteMonth = year * 12 + month - 1 + amount;
    const nextYear = Math.floor(absoluteMonth / 12);
    const nextMonth = absoluteMonth - nextYear * 12 + 1;
    return `${String(nextYear).padStart(4, "0")}-${String(nextMonth).padStart(2, "0")}`;
  }
  function monthWindow(startMonth, count = 3) {
    if (!Number.isInteger(count) || count < 1 || count > 120) throw new RangeError("عدد الأشهر غير صحيح");
    return Array.from({ length: count }, (_, index) => addMonths(startMonth, index));
  }

  function aggregatePeriodStats(items = []) {
    const totals = {
      due: 0, sent: 0, ontime: 0, required: 0, updated: 0, load: 0,
      newCases: 0, exits: 0, brainDeath: 0,
      counts: { missed: 0, late: 0, partial: 0, invalid: 0, afterDeadline: 0 },
    };
    items.forEach((item = {}) => {
      ["due", "sent", "ontime", "required", "updated", "load", "newCases", "exits", "brainDeath"].forEach((key) => { totals[key] += number(item[key]); });
      Object.keys(totals.counts).forEach((key) => { totals.counts[key] += number(item.counts?.[key]); });
    });
    const weightedScore = items.reduce((sum, item = {}) => sum + number(item.score) * number(item.due), 0);
    return {
      ...totals,
      response: totals.due ? totals.sent / totals.due * 100 : 0,
      punctuality: totals.due ? totals.ontime / totals.due * 100 : 0,
      completion: totals.required ? totals.updated / totals.required * 100 : null,
      score: totals.due ? weightedScore / totals.due : 0,
    };
  }

  function isDueDate(date, record, settings = DEFAULT_SETTINGS, now = new Date()) {
    if (date < settings.startDate) return false;
    const reported = record && typeof record.reported === "boolean"
      ? record.reported
      : Boolean(record && calculateRecord(record, settings).reported);
    if (reported) return true;
    const today = isoDate(now);
    if (date < today) return true;
    if (date > today) return false;
    return now.getHours() * 60 + now.getMinutes() > minutes(settings.deadline);
  }

  function performanceLabel(score, settings = DEFAULT_SETTINGS) {
    if (score >= number(settings.excellentAt)) return { label: "ممتاز", tone: "good" };
    if (score >= number(settings.acceptableAt)) return { label: "مقبول", tone: "warn" };
    return { label: "يحتاج تحسين", tone: "bad" };
  }

  function statusMeta(status) {
    return ({
      complete: ["✓", "مكتمل", "good"], zero: ["○", "إفادة صفرية", "good"], partial: ["◐", "تحديث جزئي", "warn"],
      late: ["▲", "متأخر", "warn"], afterDeadline: ["◆", "بعد الموعد النهائي", "bad"], missed: ["✕", "لم يرسل", "bad"],
      pending: ["…", "بانتظار الرد", "muted"], invalid: ["!", "خطأ في البيانات", "bad"], future: ["", "", "muted"],
    })[status] || ["…", status, "muted"];
  }

  function escalation(counts, settings = DEFAULT_SETTINGS) {
    if (counts.missed >= number(settings.escalation3Missed) || counts.late >= number(settings.escalation3Late)) return 3;
    if (counts.missed >= number(settings.escalation2Missed) || counts.late >= number(settings.escalation2Late)) return 2;
    return Object.values(counts).some((v) => v > 0) ? 1 : 0;
  }

  return { DEFAULT_SETTINGS, DEFAULT_HOSPITALS, minutes, clamp, number, hasValue, normalizeWeights, timeFactor, validateRecord, calculateRecord, recordKey, isoDate, daysInMonth, addDays, addMonths, monthWindow, aggregatePeriodStats, isDueDate, performanceLabel, statusMeta, escalation };
});
