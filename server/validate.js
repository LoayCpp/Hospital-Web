"use strict";

const { HttpError } = require("./http.js");

const STATE_MAX_BYTES = 1024 * 1024;
const STATE_MAX_DEPTH = 40;
const STATE_MAX_NODES = 50000;
const LOGIN_MAX_PASSWORD_LENGTH = 512;
const BLOCKED_KEYS = new Set(["__proto__", "prototype", "constructor"]);

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function invalid(message) {
  throw new HttpError(400, "invalid_state", message);
}

function assertText(value, label, { min = 0, max = 500 } = {}) {
  if (typeof value !== "string" || value.length < min || value.length > max) {
    invalid(`${label} غير صالح.`);
  }
}

function isIsoDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isTime(value) {
  if (typeof value !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return false;
  return true;
}

function assertNumber(value, label, min = 0, max = 10000) {
  if (!Number.isFinite(value) || value < min || value > max) invalid(`${label} غير صالح.`);
}

function assertSettings(settings) {
  if (!isPlainObject(settings) || !isPlainObject(settings.weights) || !isPlainObject(settings.enabled)) {
    invalid("إعدادات النظام غير صالحة.");
  }
  for (const key of ["report", "completion", "accuracy"]) {
    assertNumber(settings.weights[key], `وزن ${key}`, 0, 100);
    if (typeof settings.enabled[key] !== "boolean") invalid(`تفعيل ${key} غير صالح.`);
  }
  if (!isTime(settings.fullUntil) || !isTime(settings.deadline)) invalid("أوقات التحديث غير صالحة.");
  if (!isIsoDate(settings.startDate)) invalid("تاريخ بداية المتابعة غير صالح.");
  assertText(settings.signature, "التوقيع", { max: 300 });
  assertText(settings.whatsappGroup, "رابط مجموعة واتساب", { max: 500 });
  if (settings.whatsappGroup) {
    let url;
    try { url = new URL(settings.whatsappGroup); } catch (_) { invalid("رابط مجموعة واتساب غير صالح."); }
    if (url.protocol !== "https:") invalid("رابط مجموعة واتساب يجب أن يستخدم HTTPS.");
  }
  for (const key of ["excellentAt", "acceptableAt", "maxCaseLoadBonus"]) {
    assertNumber(settings[key], `الإعداد ${key}`, 0, 100);
  }
  for (const key of ["escalation2Missed", "escalation2Late", "escalation3Missed", "escalation3Late"]) {
    assertNumber(settings[key], `الإعداد ${key}`, 0, 1000);
  }
  for (const key of ["gradualPenalty", "caseLoadBonusEnabled"]) {
    if (typeof settings[key] !== "boolean") invalid(`الإعداد ${key} غير صالح.`);
  }
}

function assertHospital(hospital, index, ids) {
  if (!isPlainObject(hospital)) invalid(`المستشفى رقم ${index + 1} غير صالح.`);
  assertText(hospital.id, "معرف المستشفى", { min: 1, max: 80 });
  if (!/^[A-Za-z0-9_-]+$/.test(hospital.id) || ids.has(hospital.id)) invalid("معرف المستشفى مكرر أو غير صالح.");
  ids.add(hospital.id);
  assertText(hospital.name, "اسم المستشفى", { min: 1, max: 200 });
  assertText(hospital.coordinator, "اسم المنسق", { max: 200 });
  assertText(hospital.phone, "رقم التواصل", { max: 50 });
  if (typeof hospital.active !== "boolean") invalid("حالة المستشفى غير صالحة.");
}

function assertRecord(record, key, hospitalIds) {
  const parts = key.split("::");
  if (parts.length !== 2 || !isIsoDate(parts[0]) || !hospitalIds.has(parts[1])) {
    invalid("مفتاح أحد السجلات اليومية غير صالح.");
  }
  if (!isPlainObject(record)) invalid(`سجل ${key} غير صالح.`);
  const allowed = new Set(["balanceAdjustment", "newCases", "exits", "updated", "receivedAt", "brainDeath", "notes"]);
  if (Object.keys(record).some((field) => !allowed.has(field))) invalid(`سجل ${key} يحتوي حقلًا غير معروف.`);
  for (const field of ["balanceAdjustment", "newCases", "exits", "updated", "brainDeath"]) {
    if (record[field] === undefined || record[field] === "") continue;
    if (!Number.isSafeInteger(record[field]) || record[field] < 0 || record[field] > 100000) {
      invalid(`الحقل ${field} في سجل ${key} غير صالح.`);
    }
  }
  if (record.receivedAt !== undefined && record.receivedAt !== "" && !isTime(record.receivedAt)) {
    invalid(`وقت الاستلام في سجل ${key} غير صالح.`);
  }
  if (record.notes !== undefined) assertText(record.notes, `ملاحظات سجل ${key}`, { max: 2000 });
}

function assertStateSchema(data) {
  const allowed = new Set(["version", "settings", "hospitals", "records", "reminders", "lastDate"]);
  if (Object.keys(data).some((key) => !allowed.has(key))) invalid("بيانات الحالة تحتوي حقولًا رئيسية غير معروفة.");
  if (!Number.isSafeInteger(data.version) || data.version < 1 || data.version > 100) invalid("إصدار البيانات غير صالح.");
  assertSettings(data.settings);
  if (!Array.isArray(data.hospitals) || data.hospitals.length < 1 || data.hospitals.length > 200) {
    invalid("قائمة المستشفيات غير صالحة.");
  }
  const hospitalIds = new Set();
  data.hospitals.forEach((hospital, index) => assertHospital(hospital, index, hospitalIds));
  if (!isPlainObject(data.records) || Object.keys(data.records).length > 20000) invalid("سجلات الحالات غير صالحة.");
  Object.entries(data.records).forEach(([key, record]) => assertRecord(record, key, hospitalIds));
  if (!isPlainObject(data.reminders) || Object.keys(data.reminders).length > 20000) invalid("سجل التذكيرات غير صالح.");
  for (const [key, reminded] of Object.entries(data.reminders)) {
    const parts = key.split("::");
    if (parts.length !== 2 || !isIsoDate(parts[0]) || !hospitalIds.has(parts[1]) || typeof reminded !== "boolean") {
      invalid("أحد التذكيرات غير صالح.");
    }
  }
  if (!isIsoDate(data.lastDate)) invalid("تاريخ آخر تحديث غير صالح.");
}

function assertLoginPayload(body) {
  if (!isPlainObject(body) || Object.keys(body).some((key) => key !== "password")) {
    throw new HttpError(400, "invalid_request", "طلب تسجيل الدخول غير صالح.");
  }
  if (typeof body.password !== "string" || !body.password.length) {
    throw new HttpError(400, "invalid_password", "كلمة المرور مطلوبة.");
  }
  if (body.password.length > LOGIN_MAX_PASSWORD_LENGTH) {
    throw new HttpError(400, "invalid_password", "كلمة المرور أطول من الحد المسموح.");
  }
  return body.password;
}

function validateJsonTree(root) {
  const stack = [{ value: root, depth: 0 }];
  const seen = new WeakSet();
  let nodes = 0;

  while (stack.length) {
    const { value, depth } = stack.pop();
    nodes += 1;
    if (nodes > STATE_MAX_NODES) {
      throw new HttpError(413, "state_too_complex", "بيانات الحالة تحتوي عناصر أكثر من الحد المسموح.");
    }
    if (depth > STATE_MAX_DEPTH) {
      throw new HttpError(400, "state_too_deep", "تداخل بيانات الحالة أعمق من الحد المسموح.");
    }

    if (value === null || typeof value === "string" || typeof value === "boolean") continue;
    if (typeof value === "number") {
      if (!Number.isFinite(value)) {
        throw new HttpError(400, "invalid_state", "بيانات الحالة تحتوي رقمًا غير صالح.");
      }
      continue;
    }
    if (typeof value !== "object") {
      throw new HttpError(400, "invalid_state", "بيانات الحالة تحتوي قيمة غير صالحة.");
    }
    if (seen.has(value)) {
      throw new HttpError(400, "invalid_state", "بيانات الحالة لا يجوز أن تحتوي مرجعًا دائريًا.");
    }
    seen.add(value);

    if (Array.isArray(value)) {
      for (let index = value.length - 1; index >= 0; index -= 1) {
        if (!Object.hasOwn(value, index)) {
          throw new HttpError(400, "invalid_state", "بيانات الحالة تحتوي مصفوفة غير مكتملة.");
        }
        stack.push({ value: value[index], depth: depth + 1 });
      }
      continue;
    }

    if (!isPlainObject(value)) {
      throw new HttpError(400, "invalid_state", "بيانات الحالة يجب أن تكون JSON عاديًا.");
    }
    for (const key of Object.keys(value)) {
      if (BLOCKED_KEYS.has(key)) {
        throw new HttpError(400, "unsafe_state_key", "بيانات الحالة تحتوي اسم حقل غير مسموح.");
      }
      stack.push({ value: value[key], depth: depth + 1 });
    }
  }
}

function assertKnownStateShapes(data) {
  if (Object.hasOwn(data, "hospitals") && !Array.isArray(data.hospitals)) {
    throw new HttpError(400, "invalid_state", "قائمة المستشفيات غير صالحة.");
  }
  for (const key of ["settings", "records", "reminders"]) {
    if (Object.hasOwn(data, key) && !isPlainObject(data[key])) {
      throw new HttpError(400, "invalid_state", `حقل ${key} غير صالح.`);
    }
  }
  if (Object.hasOwn(data, "lastDate")
      && (typeof data.lastDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(data.lastDate))) {
    throw new HttpError(400, "invalid_state", "تاريخ آخر تحديث غير صالح.");
  }
  assertStateSchema(data);
}

function assertStateUpdatePayload(body) {
  if (!isPlainObject(body)) {
    throw new HttpError(400, "invalid_request", "طلب حفظ الحالة غير صالح.");
  }
  const keys = Object.keys(body);
  if (!keys.includes("data") || !keys.includes("revision")
      || keys.some((key) => key !== "data" && key !== "revision")) {
    throw new HttpError(400, "invalid_request", "يجب أن يحتوي الطلب على data و revision فقط.");
  }
  if (!Number.isSafeInteger(body.revision) || body.revision < 0) {
    throw new HttpError(400, "invalid_revision", "رقم مراجعة البيانات غير صالح.");
  }
  if (!isPlainObject(body.data)) {
    throw new HttpError(400, "invalid_state", "بيانات الحالة يجب أن تكون كائن JSON.");
  }

  validateJsonTree(body.data);

  let serialized;
  try {
    serialized = JSON.stringify(body.data);
  } catch (_) {
    throw new HttpError(400, "invalid_state", "تعذّر تحويل بيانات الحالة إلى JSON.");
  }
  if (Buffer.byteLength(serialized, "utf8") > STATE_MAX_BYTES) {
    throw new HttpError(413, "state_too_large", "حجم بيانات الحالة أكبر من 1 ميجابايت.");
  }
  assertKnownStateShapes(body.data);

  return { data: body.data, revision: body.revision };
}

module.exports = {
  LOGIN_MAX_PASSWORD_LENGTH,
  STATE_MAX_BYTES,
  STATE_MAX_DEPTH,
  STATE_MAX_NODES,
  assertLoginPayload,
  assertStateSchema,
  assertStateUpdatePayload,
  isPlainObject,
  validateJsonTree,
};
