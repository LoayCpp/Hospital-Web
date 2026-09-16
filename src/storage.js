(function (root) {
  "use strict";
  const R = root.HCTRules;
  const KEY = "qassim-critical-cases-v1";
  const SYNC_KEY = "qassim-critical-cases-sync-v1";
  const API_URL = "/api/state";
  const MAX_RETRY_MS = 30000;

  let backendMode = "local";
  let remoteRevision = 0;
  let pendingSnapshot = null;
  let pendingBaseRevision = null;
  let writeTimer = null;
  let retryTimer = null;
  let retryDelay = 2000;
  let writeChain = Promise.resolve();

  function uid(prefix = "id") { return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`; }
  function defaultHospitals() {
    return R.DEFAULT_HOSPITALS.map((name, i) => ({ id: `h${i + 1}`, name, coordinator: "", phone: "", active: true }));
  }
  function seedRecords() {
    const records = {};
    const firstHospital = [
      { balanceAdjustment: 4, newCases: 0, exits: 1, updated: 4, notes: "رصيد فعلي منقول من الملف السابق" },
      { newCases: 0, exits: 0, updated: 3 },
      { newCases: 0, exits: 1, updated: 3 },
      { balanceAdjustment: 3, newCases: 1, exits: 0, updated: 3, notes: "رصيد فعلي منقول من الملف السابق" },
      { newCases: 0, exits: 0, updated: 4 },
      { newCases: 1, exits: 0, updated: 4 },
      { balanceAdjustment: 4, newCases: 1, exits: 1, updated: 4, notes: "رصيد فعلي منقول من الملف السابق" },
      { newCases: 0, exits: 0, updated: 4 },
      { newCases: 0, exits: 0, updated: 4 },
      { newCases: 0, exits: 0, updated: 4 },
    ];
    for (let day = 1; day <= 10; day += 1) {
      const date = `2026-09-${String(day).padStart(2, "0")}`;
      for (let hospital = 1; hospital <= R.DEFAULT_HOSPITALS.length; hospital += 1) {
        const base = { newCases: 0, exits: 0, updated: 0, receivedAt: "03:00", brainDeath: 0, notes: "" };
        records[R.recordKey(date, `h${hospital}`)] = hospital === 1 ? { ...base, ...firstHospital[day - 1] } : base;
      }
    }
    return records;
  }
  function defaults() {
    return { version: 2, settings: JSON.parse(JSON.stringify(R.DEFAULT_SETTINGS)), hospitals: defaultHospitals(), records: seedRecords(), reminders: {}, lastDate: "2026-09-10" };
  }
  function blankDefaults() {
    return { version: 2, settings: JSON.parse(JSON.stringify(R.DEFAULT_SETTINGS)), hospitals: defaultHospitals(), records: {}, reminders: {}, lastDate: R.isoDate() };
  }
  function mergeSettings(value = {}) {
    return { ...R.DEFAULT_SETTINGS, ...value, weights: { ...R.DEFAULT_SETTINGS.weights, ...(value.weights || {}) }, enabled: { ...R.DEFAULT_SETTINGS.enabled, ...(value.enabled || {}) } };
  }
  function normalize(data) {
    const hasSource = Boolean(data && typeof data === "object" && !Array.isArray(data));
    const source = hasSource ? data : {};
    const fallback = defaults();
    const hospitals = Array.isArray(source.hospitals) && source.hospitals.length ? source.hospitals : fallback.hospitals;
    return {
      version: Number.isSafeInteger(source.version) ? source.version : fallback.version,
      settings: mergeSettings(source.settings),
      hospitals: hospitals.map((hospital) => ({
        id: hospital.id,
        name: hospital.name,
        coordinator: hospital.coordinator || "",
        phone: hospital.phone || "",
        active: hospital.active !== false,
      })),
      records: source.records && typeof source.records === "object" && !Array.isArray(source.records) ? source.records : (hasSource ? {} : fallback.records),
      reminders: source.reminders && typeof source.reminders === "object" && !Array.isArray(source.reminders) ? source.reminders : {},
      lastDate: typeof source.lastDate === "string" ? source.lastDate : fallback.lastDate,
    };
  }
  function isPlainObject(value) { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
  function isIsoDate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }
  function validateStateData(value) {
    if (!isPlainObject(value) || !isPlainObject(value.settings) || !Array.isArray(value.hospitals)
        || !isPlainObject(value.records) || !isPlainObject(value.reminders) || !isIsoDate(value.lastDate)) {
      throw new Error("بنية بيانات النسخة الاحتياطية غير صالحة");
    }
    if (!value.hospitals.length || value.hospitals.length > 200) throw new Error("قائمة المستشفيات غير صالحة");
    const ids = new Set();
    value.hospitals.forEach((hospital) => {
      if (!isPlainObject(hospital) || typeof hospital.id !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(hospital.id)
          || ids.has(hospital.id) || typeof hospital.name !== "string" || !hospital.name.trim() || hospital.name.length > 200) {
        throw new Error("بيانات أحد المستشفيات غير صالحة");
      }
      if (hospital.coordinator !== undefined && typeof hospital.coordinator !== "string") throw new Error("اسم المنسق غير صالح");
      if (hospital.phone !== undefined && typeof hospital.phone !== "string") throw new Error("رقم التواصل غير صالح");
      if (hospital.active !== undefined && typeof hospital.active !== "boolean") throw new Error("حالة المستشفى غير صالحة");
      ids.add(hospital.id);
    });
    if (Object.keys(value.records).length > 20000 || Object.keys(value.reminders).length > 20000) {
      throw new Error("عدد السجلات أكبر من الحد المسموح");
    }
    Object.entries(value.records).forEach(([key, record]) => {
      const [date, hospitalId, extra] = key.split("::");
      if (extra !== undefined || !isIsoDate(date) || !ids.has(hospitalId) || !isPlainObject(record)) {
        throw new Error("أحد السجلات اليومية غير صالح");
      }
      for (const field of ["balanceAdjustment", "newCases", "exits", "updated", "brainDeath"]) {
        const fieldValue = record[field];
        if (fieldValue === undefined || fieldValue === "") continue;
        if (!Number.isSafeInteger(fieldValue) || fieldValue < 0 || fieldValue > 100000) throw new Error("إحدى القيم العددية غير صالحة");
      }
      if (record.receivedAt !== undefined && record.receivedAt !== "" && R.minutes(record.receivedAt) === null) throw new Error("وقت استلام غير صالح");
      if (record.notes !== undefined && (typeof record.notes !== "string" || record.notes.length > 2000)) throw new Error("ملاحظات أحد السجلات غير صالحة");
    });
    Object.entries(value.reminders).forEach(([key, reminded]) => {
      const [date, hospitalId, extra] = key.split("::");
      if (extra !== undefined || !isIsoDate(date) || !ids.has(hospitalId) || typeof reminded !== "boolean") {
        throw new Error("أحد التذكيرات غير صالح");
      }
    });
    return true;
  }
  function clone(data) { return JSON.parse(JSON.stringify(normalize(data))); }
  function canonicalJson(value) {
    if (Array.isArray(value)) return value.map(canonicalJson);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalJson(value[key])]));
  }
  function sameState(left, right) {
    try { return JSON.stringify(canonicalJson(normalize(left))) === JSON.stringify(canonicalJson(normalize(right))); }
    catch (_) { return false; }
  }
  function storeLocal(data) { localStorage.setItem(KEY, JSON.stringify(normalize(data))); }
  function savedPendingRevision() {
    try {
      const parsed = JSON.parse(localStorage.getItem(SYNC_KEY) || "null");
      return Number.isSafeInteger(parsed?.revision) && parsed.revision >= 0 ? parsed.revision : null;
    } catch (_) { return null; }
  }
  function persistPending() {
    if (pendingBaseRevision === null) localStorage.removeItem(SYNC_KEY);
    else localStorage.setItem(SYNC_KEY, JSON.stringify({ revision: pendingBaseRevision, savedAt: new Date().toISOString() }));
  }
  function restorePending() {
    const revision = savedPendingRevision();
    if (revision === null) return false;
    pendingBaseRevision = revision;
    pendingSnapshot = clone(load());
    return true;
  }
  function load() {
    try {
      const parsed = JSON.parse(localStorage.getItem(KEY) || "null");
      if (parsed) validateStateData(parsed);
      return normalize(parsed);
    }
    catch (_) { return defaults(); }
  }
  function isExplicitLocalRuntime() {
    const protocol = root.location?.protocol || "";
    const hostname = root.location?.hostname || "";
    return protocol === "file:" || ["localhost", "127.0.0.1", "::1"].includes(hostname);
  }
  function emit(status, detail = {}) {
    if (typeof root.dispatchEvent !== "function" || typeof root.CustomEvent !== "function") return;
    root.dispatchEvent(new root.CustomEvent("hct-storage-status", { detail: { status, mode: backendMode, revision: remoteRevision, ...detail } }));
  }
  function save(data) {
    validateStateData(data);
    const normalized = normalize(data);
    validateStateData(normalized);
    storeLocal(normalized);
    if (["remote", "offline"].includes(backendMode)) queueRemote(normalized);
    return normalized;
  }
  function clearRecords(data) { data.records = {}; data.reminders = {}; save(data); return data; }
  function resetAll() { const data = defaults(); save(data); return data; }
  function exportBackup(data) {
    return JSON.stringify({ product: "متابعة الحالات الحرجة والوفاة الدماغية", exportedAt: new Date().toISOString(), ...normalize(data) }, null, 2);
  }
  function importBackup(text) {
    const parsed = JSON.parse(text);
    try { validateStateData(parsed); }
    catch (_) { throw new Error("ملف النسخة الاحتياطية غير صالح"); }
    const data = normalize(parsed); save(data); return data;
  }
  function addHospital(data) {
    data.hospitals.push({ id: uid("h"), name: "مستشفى جديد", coordinator: "", phone: "", active: true }); save(data);
  }
  function getRaw(data, date, hospitalId) { return data.records[R.recordKey(date, hospitalId)] || {}; }
  function previousClosing(data, date, hospitalId) {
    const priorDates = [...new Set(Object.keys(data.records)
      .filter((key) => key.endsWith(`::${hospitalId}`))
      .map((key) => key.split("::")[0])
      .filter((d) => d < date))].sort();
    let carried = 0;
    for (const prior of priorDates) {
      const raw = data.records[R.recordKey(prior, hospitalId)] || {};
      carried = R.calculateRecord({ ...raw, carried }, data.settings).closing;
    }
    return carried;
  }
  function recordFor(data, date, hospitalId) {
    const raw = getRaw(data, date, hospitalId);
    const carried = previousClosing(data, date, hospitalId);
    return R.calculateRecord({ ...raw, carried }, data.settings);
  }
  function saveRecord(data, date, hospitalId, patch) {
    const key = R.recordKey(date, hospitalId);
    data.records[key] = { ...getRaw(data, date, hospitalId), ...patch };
    data.lastDate = date;
    save(data);
  }

  async function jsonResponse(response) {
    const text = await response.text();
    try { return text ? JSON.parse(text) : {}; }
    catch (_) { return {}; }
  }
  async function request(url, options = {}) {
    return fetch(url, { credentials: "same-origin", cache: "no-store", ...options, headers: { "content-type": "application/json", ...(options.headers || {}) } });
  }
  function scheduleRetry() {
    if (retryTimer || !pendingSnapshot) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      flushPending();
      retryDelay = Math.min(retryDelay * 2, MAX_RETRY_MS);
    }, retryDelay);
  }
  async function writeSnapshot(snapshot, expectedRevision) {
    emit("saving");
    let response;
    try {
      response = await request(API_URL, { method: "PUT", body: JSON.stringify({ data: snapshot, revision: expectedRevision }) });
    } catch (_) {
      backendMode = "offline";
      pendingSnapshot = pendingSnapshot || snapshot;
      pendingBaseRevision = expectedRevision;
      persistPending();
      emit("offline", { message: "تعذر الاتصال؛ التغييرات محفوظة على هذا الجهاز وستتم إعادة المحاولة." });
      scheduleRetry();
      return;
    }
    const payload = await jsonResponse(response);
    if (response.ok) {
      backendMode = "remote";
      remoteRevision = Number(payload.revision || remoteRevision + 1);
      retryDelay = 2000;
      if (pendingSnapshot) pendingBaseRevision = remoteRevision;
      else pendingBaseRevision = null;
      persistPending();
      emit("saved", { updatedAt: payload.updatedAt });
      return;
    }
    if (response.status === 401) {
      backendMode = "locked";
      pendingSnapshot = pendingSnapshot || snapshot;
      pendingBaseRevision = expectedRevision;
      persistPending();
      emit("auth-required", { message: "انتهت جلسة الدخول. سجّل الدخول مجددًا قبل متابعة المزامنة." });
      return;
    }
    if (response.status === 409) {
      backendMode = "conflict";
      pendingSnapshot = pendingSnapshot || snapshot;
      pendingBaseRevision = expectedRevision;
      persistPending();
      emit("conflict", { message: "توجد تغييرات أحدث من جهاز آخر. لم تُستبدل أي بيانات؛ نزّل نسخة احتياطية قبل اختيار نسخة الخادم." });
      return;
    }
    backendMode = "offline";
    pendingSnapshot = pendingSnapshot || snapshot;
    pendingBaseRevision = expectedRevision;
    persistPending();
    emit("error", { message: payload.message || "تعذر حفظ البيانات في الخادم." });
    if (response.status >= 500) scheduleRetry();
  }
  function flushPending() {
    if (!pendingSnapshot || !["remote", "offline"].includes(backendMode)) return writeChain;
    const snapshot = pendingSnapshot;
    const expectedRevision = pendingBaseRevision ?? remoteRevision;
    pendingSnapshot = null;
    writeChain = writeChain.then(() => writeSnapshot(snapshot, expectedRevision)).finally(() => {
      if (pendingSnapshot && ["remote", "offline"].includes(backendMode)) scheduleFlush(50);
    });
    return writeChain;
  }
  function scheduleFlush(delay = 450) {
    clearTimeout(writeTimer);
    writeTimer = setTimeout(() => { writeTimer = null; flushPending(); }, delay);
  }
  function queueRemote(data) {
    pendingSnapshot = clone(data);
    if (pendingBaseRevision === null) pendingBaseRevision = remoteRevision;
    persistPending();
    emit("queued");
    scheduleFlush();
  }
  async function initializeRemote() {
    emit("connecting");
    let response;
    try { response = await request(API_URL); }
    catch (_) {
      if (isExplicitLocalRuntime()) {
        backendMode = "local";
        emit("local");
        return { status: "local", data: load() };
      }
      backendMode = "error";
      const message = "تعذر التحقق من جلسة الدخول. أعد الاتصال بالشبكة ثم حاول مجددًا.";
      emit("error", { message });
      return { status: "error", message };
    }
    if (response.status === 404) {
      if (isExplicitLocalRuntime()) {
        backendMode = "local";
        emit("local");
        return { status: "local", data: load() };
      }
      backendMode = "error";
      const message = "واجهة الخادم غير متاحة في هذا النشر.";
      emit("error", { message });
      return { status: "error", message };
    }
    const payload = await jsonResponse(response);
    if (response.status === 401) {
      backendMode = "locked";
      emit("auth-required");
      return { status: "auth-required" };
    }
    if (!response.ok) {
      backendMode = "error";
      const message = payload.message || "إعداد الخادم غير مكتمل.";
      emit("error", { message });
      return { status: "error", message };
    }
    backendMode = "remote";
    remoteRevision = Number(payload.revision || 0);
    const persistedRevision = savedPendingRevision();
    if (persistedRevision !== null) {
      restorePending();
      if (persistedRevision !== remoteRevision) {
        if (payload.data && sameState(payload.data, load())) {
          const remoteData = normalize(payload.data);
          pendingSnapshot = null;
          pendingBaseRevision = null;
          persistPending();
          storeLocal(remoteData);
          emit("saved", { updatedAt: payload.updatedAt });
          return { status: "remote", data: remoteData };
        }
        backendMode = "conflict";
        emit("conflict", { message: "توجد نسخة محلية غير متزامنة ونسخة أحدث في Neon. لم تُستبدل أي منهما." });
        return { status: "conflict", data: load() };
      }
      scheduleFlush(50);
      emit("queued", { message: "جارٍ استكمال رفع التغييرات المحلية." });
      return { status: "remote", data: load() };
    }
    if (payload.data) {
      try { validateStateData(payload.data); }
      catch (_) {
        backendMode = "error";
        const message = "بيانات Neon لا تطابق بنية النظام. لم يتم تحميلها لحماية النسخة المحلية.";
        emit("error", { message });
        return { status: "error", message };
      }
      const remoteData = normalize(payload.data);
      storeLocal(remoteData);
      emit("saved", { updatedAt: payload.updatedAt });
      return { status: "remote", data: remoteData };
    }

    const empty = blankDefaults();
    let initial;
    try {
      initial = await request(API_URL, { method: "PUT", body: JSON.stringify({ data: empty, revision: 0 }) });
    } catch (_) {
      backendMode = "error";
      const message = "انقطع الاتصال أثناء تهيئة قاعدة البيانات. أعد المحاولة دون إدخال بيانات جديدة.";
      emit("error", { message });
      return { status: "error", message };
    }
    const initialPayload = await jsonResponse(initial);
    if (initial.ok) {
      remoteRevision = Number(initialPayload.revision || 1);
      storeLocal(empty);
      emit("saved", { updatedAt: initialPayload.updatedAt });
      return { status: "remote", data: empty, initialized: true };
    }
    if (initial.status === 409 && initialPayload.data) {
      try { validateStateData(initialPayload.data); }
      catch (_) {
        backendMode = "error";
        const message = "أحدث نسخة في Neon غير صالحة لهذا الإصدار من النظام.";
        emit("error", { message });
        return { status: "error", message };
      }
      remoteRevision = Number(initialPayload.revision || 1);
      const current = normalize(initialPayload.data);
      storeLocal(current);
      emit("saved", { updatedAt: initialPayload.updatedAt });
      return { status: "remote", data: current };
    }
    const message = initialPayload.message || "تعذر تهيئة قاعدة البيانات.";
    backendMode = "error";
    emit("error", { message });
    return { status: "error", message };
  }
  async function acceptRemoteState() {
    const response = await request(API_URL);
    const payload = await jsonResponse(response);
    if (response.status === 401) throw new Error("انتهت جلسة الدخول.");
    if (!response.ok) throw new Error(payload.message || "تعذر تحميل نسخة Neon.");
    if (payload.data) validateStateData(payload.data);
    const remoteData = payload.data ? normalize(payload.data) : blankDefaults();
    clearTimeout(writeTimer);
    clearTimeout(retryTimer);
    pendingSnapshot = null;
    pendingBaseRevision = null;
    remoteRevision = Number(payload.revision || 0);
    backendMode = "remote";
    persistPending();
    storeLocal(remoteData);
    emit("saved", { updatedAt: payload.updatedAt });
    return remoteData;
  }
  async function login(password) {
    const response = await request("/api/login", { method: "POST", body: JSON.stringify({ password }) });
    const payload = await jsonResponse(response);
    if (!response.ok) throw new Error(payload.message || "تعذر تسجيل الدخول.");
    return payload;
  }
  async function logout() {
    const response = await request("/api/logout", { method: "POST", body: "{}" });
    const payload = await jsonResponse(response);
    if (!response.ok) throw new Error(payload.message || "تعذر تسجيل الخروج من الخادم.");
    clearTimeout(writeTimer);
    clearTimeout(retryTimer);
    pendingSnapshot = null;
    pendingBaseRevision = null;
    localStorage.removeItem(KEY);
    localStorage.removeItem(SYNC_KEY);
    backendMode = "locked";
    remoteRevision = 0;
  }
  function status() { return { mode: backendMode, revision: remoteRevision, pending: Boolean(pendingSnapshot) }; }

  root.HCTStorage = {
    KEY, SYNC_KEY, uid, defaults, blankDefaults, normalize, validateStateData, load, save, clearRecords, resetAll, exportBackup, importBackup,
    addHospital, getRaw, previousClosing, recordFor, saveRecord, initializeRemote, acceptRemoteState, login, logout, flush: flushPending, status,
  };
})(window);
