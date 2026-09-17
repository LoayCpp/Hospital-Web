(function () {
  "use strict";
  const R = window.HCTRules;
  const S = window.HCTStorage;
  const X = window.HCTXlsx;
  let data = S.blankDefaults();
  let accessGranted = false;
  let view = "today";
  let selectedDate = R.isoDate();
  let selectedMonth = selectedDate.slice(0, 7);
  let selectedYear = selectedDate.slice(0, 4);
  let selectedQuarterStart = selectedMonth;
  let selectedQuarterHospital = "all";
  let reportMode = "day";
  let lastStorageAlert = "";

  const app = document.getElementById("app");
  const viewTitles = {
    today: ["متابعة اليوم", "حالة كل مستشفى والإجراء المطلوب قبل الرفع للمركز السعودي لزراعة الأعضاء"],
    report: ["تقرير الحالة (PDF)", "تقرير بحالة المستشفيات ونسبها بالألوان — جاهز للطباعة والمشاركة"],
    entry: ["إدخال البيانات", "سجّل رد كل مستشفى كما وصل — يُحفظ تلقائيًا"],
    dashboard: ["لوحة المؤشرات", "أداء المستشفيات خلال الشهر المختار"],
    monthly: ["المتابعة الشهرية", "استجابة كل مستشفى يومًا بيوم"],
    quarterly: ["ملخص ثلاثة أشهر", "فترة متحركة تبدأ من الشهر المختار وتشمل الشهرين التاليين"],
    violations: ["المخالفات والتصعيد", "المستشفيات غير الملتزمة ومستوى التصعيد المقترح"],
    annual: ["الملخص السنوي", "المؤشر الشهري لكل مستشفى واتجاه التجمع"],
    settings: ["الإعدادات", "عناصر الدرجة ووقت التحديث والتصعيد والمستشفيات"],
    backup: ["البيانات والنسخ الاحتياطي", "تصدير واستيراد وحفظ البيانات"],
    guide: ["دليل الاستخدام", "خطوات العمل اليومي وقواعد الحساب"],
  };
  const monthNames = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
  const dayNames = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
  const statusClass = { good: "success", warn: "warning", bad: "danger", muted: "neutral" };

  function activeHospitals() { return data.hospitals.filter((h) => h.active); }
  function n(value) { return R.number(value); }
  function pct(value, digits = 0) { return `${Number(value || 0).toFixed(digits)}%`; }
  function esc(value) { return String(value ?? "").replace(/[&<>'"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[c]); }
  function formatDate(iso) { const d = new Date(`${iso}T12:00:00`); return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`; }
  function fullDate(iso) { const d = new Date(`${iso}T12:00:00`); return `${dayNames[d.getDay()]} ${formatDate(iso)}`; }
  function monthLabel(ym) { const [y, m] = ym.split("-").map(Number); return `${monthNames[m - 1]} ${y}`; }
  function nowTime() { const d = new Date(); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; }
  function download(filename, content, type = "application/octet-stream") { const blob = content instanceof Blob ? content : new Blob([content], { type }); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = filename; a.hidden = true; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000); }
  async function copyText(text) { try { await navigator.clipboard.writeText(text); toast("تم النسخ"); } catch (_) { const t = document.createElement("textarea"); t.value = text; document.body.appendChild(t); t.select(); document.execCommand("copy"); t.remove(); toast("تم النسخ"); } }
  function toast(message, tone = "success") { const el = document.createElement("div"); el.className = `toast ${tone}`; el.textContent = message; document.body.appendChild(el); requestAnimationFrame(() => el.classList.add("show")); setTimeout(() => el.remove(), 2600); }

  function updateStorageStatus(detail = {}) {
    const state = detail.mode ? detail : { ...S.status(), status: S.status().mode };
    const el = document.getElementById("syncStatus");
    const logout = document.getElementById("logoutButton");
    const labels = {
      connecting: ["جارٍ الاتصال بقاعدة البيانات…", "waiting"],
      queued: ["تغييرات بانتظار الحفظ…", "waiting"],
      saving: ["جارٍ الحفظ في Neon…", "waiting"],
      saved: ["متصل بقاعدة Neon", "online"],
      remote: ["متصل بقاعدة Neon", "online"],
      local: ["حفظ محلي على هذا الجهاز", "local"],
      offline: ["غير متصل — الحفظ محلي مؤقتًا", "offline"],
      conflict: ["تعارض يحتاج مراجعة", "offline"],
      error: ["خطأ في اتصال قاعدة البيانات", "offline"],
      "auth-required": ["يلزم تسجيل الدخول", "offline"],
      locked: ["يلزم تسجيل الدخول", "offline"],
    };
    const key = state.status || state.mode || "local";
    const [label, tone] = labels[key] || labels.local;
    if (el) {
      el.className = `privacy-dot storage-${tone}`;
      el.innerHTML = `<span class="dot"></span> ${label}`;
    }
    if (logout) logout.hidden = !["remote", "offline", "conflict"].includes(state.mode);
    if (state.message && ["conflict", "error", "auth-required"].includes(state.status) && lastStorageAlert !== `${state.status}:${state.message}`) {
      lastStorageAlert = `${state.status}:${state.message}`;
      toast(state.message, "danger");
    }
  }

  function renderLogin(message = "") {
    accessGranted = false;
    data = S.blankDefaults();
    document.body.classList.add("auth-locked");
    document.querySelectorAll("[data-nav]").forEach((a) => a.classList.remove("active"));
    document.getElementById("pageTitle").textContent = "تسجيل الدخول";
    document.getElementById("pageSubtitle").textContent = "الوصول إلى قاعدة بيانات متابعة الحالات";
    document.getElementById("pageTools")?.replaceChildren();
    app.innerHTML = `<section class="auth-card panel"><div class="auth-mark">ت</div><h2>دخول النظام</h2><p>أدخل كلمة المرور التي ستضعها في إعدادات Vercel. لا تُحفظ كلمة المرور في المتصفح.</p>${message ? `<div class="notice danger">${esc(message)}</div>` : ""}<form id="loginForm"><label>كلمة المرور<input id="loginPassword" type="password" autocomplete="current-password" required autofocus></label><button class="primary" type="submit">تسجيل الدخول</button></form></section>`;
    document.getElementById("loginForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const button = form.querySelector("button");
      button.disabled = true;
      button.textContent = "جارٍ التحقق…";
      try {
        await S.login(document.getElementById("loginPassword").value);
        await start();
      } catch (error) {
        renderLogin(error.message);
      }
    });
    updateStorageStatus({ status: "auth-required", mode: "locked" });
  }

  function renderStartupError(message) {
    accessGranted = false;
    data = S.blankDefaults();
    document.body.classList.add("auth-locked");
    document.getElementById("pageTitle").textContent = "إعداد الخادم غير مكتمل";
    document.getElementById("pageSubtitle").textContent = "تحقق من متغيرات Vercel واتصال Neon";
    document.getElementById("pageTools")?.replaceChildren();
    app.innerHTML = `<section class="auth-card panel"><h2>تعذر تشغيل النسخة السحابية</h2><p>${esc(message)}</p><button class="primary" id="retryStartup">إعادة المحاولة</button><p class="muted">يلزم ضبط DATABASE_URL وAPP_PASSWORD وSESSION_SECRET ثم إعادة النشر.</p></section>`;
    document.getElementById("retryStartup").addEventListener("click", start);
  }

  function renderConflict(message = "توجد تغييرات محلية لم تُرفع، بينما تحتوي Neon على نسخة أحدث.") {
    document.querySelectorAll("[data-nav]").forEach((a) => a.classList.remove("active"));
    document.getElementById("pageTitle").textContent = "تعارض في المزامنة";
    document.getElementById("pageSubtitle").textContent = "حافظنا على النسختين ولم نستبدل البيانات تلقائيًا";
    document.getElementById("pageTools")?.replaceChildren();
    app.innerHTML = `<section class="auth-card panel"><h2>اختر بعد حفظ نسخة احتياطية</h2><p>${esc(message)}</p><div class="notice danger">نزّل النسخة المحلية أولًا. اختيار نسخة Neon بعد ذلك سيتجاهل التغييرات المحلية غير المرفوعة.</div><div class="conflict-actions"><button class="primary" id="downloadConflictBackup">تنزيل النسخة المحلية</button><button id="acceptRemoteState">اعتماد نسخة Neon</button></div></section>`;
    document.getElementById("downloadConflictBackup").addEventListener("click", () => {
      download(`نسخة-محلية-قبل-حل-التعارض-${R.isoDate()}.json`, S.exportBackup(data), "application/json;charset=utf-8");
    });
    document.getElementById("acceptRemoteState").addEventListener("click", async () => {
      if (!confirm("سيتم تجاهل التغييرات المحلية غير المرفوعة واعتماد أحدث نسخة من Neon. هل نزّلت النسخة الاحتياطية؟")) return;
      try {
        data = await S.acceptRemoteState();
        toast("تم اعتماد نسخة Neon");
        render();
      } catch (error) {
        renderConflict(error.message);
      }
    });
  }

  async function start() {
    accessGranted = false;
    document.body.classList.add("auth-locked");
    document.getElementById("pageTitle").textContent = "جاري التشغيل";
    document.getElementById("pageSubtitle").textContent = "الاتصال بمصدر البيانات";
    document.getElementById("pageTools")?.replaceChildren();
    app.innerHTML = `<section class="auth-card panel"><h2>جارٍ تحميل البيانات…</h2><p>لحظات ويتم التحقق من التخزين الآمن.</p></section>`;
    let result;
    try { result = await S.initializeRemote(); }
    catch (_) { renderStartupError("تعذر الاتصال بالخادم. تحقق من الشبكة ثم أعد المحاولة."); return; }
    if (result.status === "auth-required") { renderLogin(); return; }
    if (result.status === "error") { renderStartupError(result.message); return; }
    data = result.data || S.load();
    accessGranted = true;
    document.body.classList.remove("auth-locked");
    if (result.status === "conflict") { renderConflict(); return; }
    render();
    registerWebMcp();
    updateStorageStatus({ status: result.status === "remote" ? "saved" : result.status, mode: S.status().mode });
    if (result.initialized) toast("تم إنشاء قاعدة فارغة. استورد نسختك الاحتياطية لنقل البيانات السابقة.");
  }

  function raw(date, id) { return S.getRaw(data, date, id); }
  function calc(date, id) { return S.recordFor(data, date, id); }
  function resolvedStatus(date, result) {
    if (result.reported && !result.valid) return "invalid";
    if (result.reported) return result.status;
    const today = R.isoDate();
    if (date > today) return "future";
    if (R.isDueDate(date, result, data.settings)) return "missed";
    return "pending";
  }
  function badge(status, withText = true) { const [icon, label, tone] = R.statusMeta(status); return `<span class="badge ${statusClass[tone]}"><b>${icon}</b>${withText ? esc(label) : ""}</span>`; }
  function grade(score) { const p = R.performanceLabel(score, data.settings); return `<span class="score ${statusClass[p.tone]}">${pct(score)}<small>${p.label}</small></span>`; }
  function dateControls() { return `<div class="toolbar no-print"><button data-date-step="-1">السابق</button><input id="datePicker" type="date" value="${selectedDate}"><button data-date-step="1">التالي</button><button class="soft" data-action="print">طباعة</button></div>`; }
  function monthControls() { return `<div class="toolbar no-print"><input id="monthPicker" type="month" value="${selectedMonth}"><button class="soft" data-action="print">طباعة</button><button class="soft" data-action="month-report">تقرير الشهر PDF</button></div>`; }
  function yearControls() { return `<div class="toolbar no-print"><input id="yearPicker" type="number" min="2020" max="2100" value="${selectedYear}"><button class="soft" data-action="print">طباعة</button></div>`; }

  function dayRows(date) {
    return activeHospitals().map((h) => {
      const r = calc(date, h.id); const status = resolvedStatus(date, r);
      return { h, r, status };
    });
  }

  function dateRangeForMonth(ym) {
    const [year, month] = ym.split("-").map(Number); const total = R.daysInMonth(year, month); const out = [];
    for (let d = 1; d <= total; d += 1) out.push(`${ym}-${String(d).padStart(2, "0")}`);
    return out;
  }

  function hospitalMonth(hospital, ym) {
    const dates = dateRangeForMonth(ym); const rows = [];
    dates.forEach((date) => {
      const r = calc(date, hospital.id); const due = R.isDueDate(date, r, data.settings);
      if (!due) return;
      const status = resolvedStatus(date, r); rows.push({ date, r, status });
    });
    const due = rows.length; const sent = rows.filter((x) => x.r.reported).length; const ontime = rows.filter((x) => { const received=R.minutes(x.r.receivedAt); return x.r.reported && received!==null && received<=R.minutes(data.settings.fullUntil); }).length;
    const required = rows.reduce((s, x) => s + x.r.required, 0); const updated = rows.reduce((s, x) => s + x.r.effectiveUpdated, 0);
    const score = due ? rows.reduce((s, x) => s + x.r.score, 0) / due : 0;
    const counts = { missed: 0, late: 0, partial: 0, invalid: 0, afterDeadline: 0 };
    rows.forEach((x) => { if (Object.hasOwn(counts, x.status)) counts[x.status] += 1; });
    const load = rows.reduce((s, x) => s + x.r.required + n(x.r.newCases), 0);
    return { hospital, rows, due, sent, ontime, required, updated, response: due ? sent / due * 100 : 0, punctuality: due ? ontime / due * 100 : 0, completion: required ? updated / required * 100 : null, score, counts, load, ...activityTotals(rows) };
  }

  function monthSummary(ym) {
    const hospitals = activeHospitals().map((h) => hospitalMonth(h, ym));
    const maxLoad = Math.max(0, ...hospitals.map((x) => x.load));
    hospitals.forEach((x) => { x.bonus = data.settings.caseLoadBonusEnabled && maxLoad ? x.load / maxLoad * n(data.settings.maxCaseLoadBonus) : 0; x.rankingPoints = Math.min(110, x.score + x.bonus); });
    hospitals.sort((a, b) => b.rankingPoints - a.rankingPoints || b.score - a.score || b.load - a.load);
    const due = hospitals.reduce((s, x) => s + x.due, 0); const sent = hospitals.reduce((s, x) => s + x.sent, 0); const ontime = hospitals.reduce((s, x) => s + x.ontime, 0);
    const required = hospitals.reduce((s, x) => s + x.required, 0); const updated = hospitals.reduce((s, x) => s + x.updated, 0);
    const scores = hospitals.flatMap((x) => x.rows.map((r) => r.r.score));
    return { hospitals, due, sent, ontime, required, updated, response: due ? sent / due * 100 : 0, punctuality: due ? ontime / due * 100 : 0, completion: required ? updated / required * 100 : null, score: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0 };
  }

  function activityTotals(rows) {
    return rows.reduce((total, item) => {
      total.newCases += n(item.r.newCases);
      total.exits += n(item.r.exits);
      total.brainDeath += n(item.r.brainDeath);
      return total;
    }, { newCases: 0, exits: 0, brainDeath: 0 });
  }

  function hospitalPeriod(hospital, months) {
    const monthStats = months.map((month) => ({ ...hospitalMonth(hospital, month), month }));
    const rows = monthStats.flatMap((item) => item.rows);
    return { hospital, monthStats, rows, ...R.aggregatePeriodStats(monthStats) };
  }

  function quarterlySummary(startMonth = selectedQuarterStart, hospitalId = selectedQuarterHospital) {
    const months = R.monthWindow(startMonth, 3);
    const allHospitals = activeHospitals().map((hospital) => hospitalPeriod(hospital, months));
    const maxLoad = Math.max(0, ...allHospitals.map((item) => item.load));
    allHospitals.forEach((item) => {
      item.bonus = data.settings.caseLoadBonusEnabled && maxLoad ? item.load / maxLoad * n(data.settings.maxCaseLoadBonus) : 0;
      item.rankingPoints = Math.min(110, item.score + item.bonus);
    });
    allHospitals.sort((a, b) => b.rankingPoints - a.rankingPoints || b.score - a.score || b.load - a.load);
    allHospitals.forEach((item, index) => { item.rank = index + 1; });
    const validHospitalId = allHospitals.some((item) => item.hospital.id === hospitalId) ? hospitalId : "all";
    const hospitals = validHospitalId === "all" ? allHospitals : allHospitals.filter((item) => item.hospital.id === validHospitalId);
    const monthly = months.map((month) => {
      const items = validHospitalId === "all"
        ? allHospitals.map((item) => item.monthStats.find((entry) => entry.month === month))
        : [hospitals[0].monthStats.find((entry) => entry.month === month)];
      return { month, ...R.aggregatePeriodStats(items) };
    });
    return { startMonth, months, hospitalId: validHospitalId, hospitals, monthly, ...R.aggregatePeriodStats(hospitals) };
  }

  function statCard(label, value, note, tone = "teal") { return `<article class="stat-card ${tone}"><span>${label}</span><strong>${value}</strong><small>${note}</small></article>`; }

  function renderToday() {
    const rows = dayRows(selectedDate); const sent = rows.filter((x) => x.r.reported).length; const ontime = rows.filter((x) => { const received=R.minutes(x.r.receivedAt); return x.r.reported && received!==null && received<=R.minutes(data.settings.fullUntil); }).length;
    const closing = rows.reduce((s, x) => s + x.r.closing, 0); const brain = rows.reduce((s, x) => s + n(x.r.brainDeath), 0); const required = rows.reduce((s, x) => s + x.r.required, 0); const updated = rows.reduce((s, x) => s + x.r.effectiveUpdated, 0);
    const now = new Date(); const today = selectedDate === R.isoDate(now); const currentMinutes = now.getHours() * 60 + now.getMinutes(); const full = R.minutes(data.settings.fullUntil); const deadline = R.minutes(data.settings.deadline);
    let phase = "متابعة اليوم المختار"; let phaseTone = "calm"; let countText = "";
    if (today && currentMinutes <= full) { const left = full - currentMinutes; phase = `متبقٍ على موعد التحديث (${data.settings.fullUntil})`; countText = `الوقت المتبقي ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}، والدرجة كاملة حتى الموعد.`; }
    else if (today && currentMinutes < deadline) { const left = deadline - currentMinutes; phase = `مرحلة الخصم التدريجي — متبقٍ ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`; phaseTone = "amber"; countText = `معامل الوقت الآن ${pct(R.clamp((deadline-currentMinutes)/(deadline-full)*100,0,100))}.`; }
    else if (today) { phase = `انتهى الموعد النهائي — ${data.settings.deadline}`; phaseTone = "red"; countText = "أي رد جديد لهذا اليوم درجته صفر."; }
    const waiting = rows.filter((x) => !x.r.reported);
    return `${dateControls()}<section class="phase ${phaseTone}"><div><span class="phase-time">${today ? nowTime() : formatDate(selectedDate)}</span><div><h3>${phase}</h3><p>${countText} أرسل ${sent} من ${rows.length}، وبانتظار ${waiting.length}.</p></div></div><div class="actions"><button class="primary" data-view="entry">إدخال بيانات هذا اليوم</button><button data-view="report">تقرير PDF للمجموعة</button></div><div class="hospital-pills">${rows.map((x) => `<button data-open-entry="${x.h.id}" class="${statusClass[R.statusMeta(x.status)[2]]}">${R.statusMeta(x.status)[0]} ${esc(x.h.name.replace(/^مستشفى |^مركز /, ""))}</button>`).join("")}</div></section>
    <section class="stats-grid">${statCard("استجاب", `${sent} / ${rows.length}`, "مستشفى أرسل تقريره")}${statCard("في الوقت", ontime, `حتى ${data.settings.fullUntil}`, "green")}${statCard("لم يرسل", waiting.length, "بانتظار الرد أو لم يرسل", "red")}${statCard("الحالات النشطة", closing, "الرصيد الختامي لليوم", "blue")}${statCard("وفاة دماغية", brain, "حسب الإدخال", "violet")}${statCard("اكتمال التحديث", pct(required ? updated / required * 100 : 100), `${updated} من ${required} حالة`, "green")}</section>
    <section class="panel"><div class="panel-title"><h3>حالة كل مستشفى</h3><span>${fullDate(selectedDate)}</span></div><div class="table-wrap"><table><thead><tr><th>المستشفى</th><th>المحدث / المطلوب</th><th>جديد</th><th>خروج</th><th>الوقت</th><th>وفاة دماغية</th><th>الختامي</th><th>الحالة</th><th>درجة اليوم</th><th>الإجراء المطلوب</th></tr></thead><tbody>${rows.map(({ h, r, status }) => `<tr><td><strong>${esc(h.name)}</strong></td><td>${r.required ? `${r.effectiveUpdated} / ${r.required}` : "لا حالات"}</td><td>${n(r.newCases) || "—"}</td><td>${n(r.exits) || "—"}</td><td>${r.receivedAt || "—"}</td><td>${n(r.brainDeath) || "—"}</td><td><strong>${r.closing}</strong></td><td>${badge(status)}</td><td>${r.reported ? grade(r.score) : "بانتظار"}</td><td>${actionText(status)}</td></tr>`).join("")}</tbody></table></div></section>
    <div class="followup-grid">${reminderSection(rows)}${summaryDraft(rows)}</div>`;
  }

  function actionText(status) { return ({ complete: "مكتمل — لا إجراء", zero: "تمت الإفادة الصفرية", partial: "اطلب استكمال الحالات", late: "تم الاستلام مع خصم", afterDeadline: "وثّق مخالفة الموعد", missed: "تواصل وصعّد حسب التكرار", pending: `اتصل الآن — الدرجة تنخفض حتى ${data.settings.deadline}`, invalid: "صحّح البيانات", future: "—" })[status]; }

  function reminderMessage(rows, single) {
    const targets = single ? [single] : rows.filter((x) => !x.r.reported);
    const names = targets.map((x) => `• ${x.h.name}`).join("\n");
    const timeText = nowTime() <= data.settings.fullUntil ? `نرجو إرسال تحديث اليوم قبل الساعة ${data.settings.fullUntil}` : `تجاوزنا الساعة ${data.settings.fullUntil} والدرجة تنخفض تدريجيًا حتى ${data.settings.deadline}`;
    return `السلام عليكم ورحمة الله،\n${timeText}، ولم يصلنا بعد تحديث يوم ${formatDate(selectedDate)} من:\n${names}\nشاكرين تعاونكم.\n— ${data.settings.signature}`;
  }
  function reminderSection(rows) {
    const waiting = rows.filter((x) => !x.r.reported); if (!waiting.length) return "";
    return `<section class="panel no-print"><div class="panel-title"><h3>رسائل التذكير</h3><span>${waiting.length} مستشفى</span></div><div class="reminder-group"><div><strong>رسالة جماعية لمنسقي المستشفيات</strong><p>${esc(reminderMessage(rows, null)).replace(/\n/g, "<br>")}</p></div><button data-copy="group-reminder">نسخ للمجموعة</button></div><div class="reminder-list">${waiting.map((x) => `<div><span>${esc(x.h.name)}</span>${badge(x.status)}<button data-copy-hospital="${x.h.id}">نسخ</button>${x.h.phone ? `<a class="button-link" target="_blank" rel="noopener" href="https://wa.me/${esc(x.h.phone.replace(/\D/g,""))}">واتساب</a>` : `<small>أضف رقم التواصل من الإعدادات</small>`}<label><input type="checkbox" data-reminded="${x.h.id}" ${data.reminders[R.recordKey(selectedDate,x.h.id)] ? "checked" : ""}> تم التذكير</label></div>`).join("")}</div></section>`;
  }
  function summaryDraft(rows) {
    const sent = rows.filter((x) => x.r.reported).length; const closing = rows.reduce((s,x)=>s+x.r.closing,0); const brain=rows.reduce((s,x)=>s+n(x.r.brainDeath),0); const news=rows.reduce((s,x)=>s+n(x.r.newCases),0); const exits=rows.reduce((s,x)=>s+n(x.r.exits),0);
    const lines=rows.filter((x)=>x.r.closing>0).map((x)=>`• ${x.h.name}: الحالات النشطة (${x.r.closing})`).join("\n");
    const missing=rows.length-sent; const text=`ملخص الحالات الحرجة وحالات الوفاة الدماغية — تجمع القصيم الصحي — ${formatDate(selectedDate)}\nإجمالي الحالات النشطة: ${closing} | منها وفاة دماغية: ${brain} | بلاغات جديدة: ${news} | خروج/وفاة/تبرع: ${exits}\nالمستشفيات المستجيبة: ${sent} من ${rows.length}\n${lines || "لا توجد حالات نشطة"}${missing ? `\nملاحظة: لم يصل تحديث ${missing} مستشفى حتى وقت إعداد الملخص.` : "\nاكتملت إفادات جميع المستشفيات — جاهز للرفع."}`;
    return `<section class="panel"><div class="panel-title"><h3>مسودة ملخص الرفع للمركز</h3><button class="no-print" data-copy="summary">نسخ الملخص</button></div><pre id="summaryText">${esc(text)}</pre></section>`;
  }

  function renderEntry() {
    const rows = dayRows(selectedDate);
    const totals = rows.reduce((a,x)=>({carried:a.carried+x.r.carried,newCases:a.newCases+n(x.r.newCases),exits:a.exits+n(x.r.exits),updated:a.updated+n(x.r.updated),brain:a.brain+n(x.r.brainDeath),required:a.required+x.r.required,closing:a.closing+x.r.closing}),{carried:0,newCases:0,exits:0,updated:0,brain:0,required:0,closing:0});
    return `${dateControls()}<div class="notice"><b>قاعدة اليوم:</b> المطلوب تحديثه هو الرصيد المرحّل. البلاغ الجديد يُتابع من الغد، ويجب إدخال عدد الحالات المحدثة مستقلًا عن الخروج/الوفاة/التبرع. الوقت كامل حتى ${data.settings.fullUntil} ثم خصم تدريجي حتى ${data.settings.deadline}.</div><section class="panel"><div class="panel-title"><h3>${fullDate(selectedDate)}</h3><span class="autosave">● يُحفظ تلقائيًا</span></div><div class="table-wrap entry-table"><table><thead><tr><th>المستشفى</th><th>المرحّل</th><th>تعديل الرصيد</th><th>بلاغات جديدة</th><th>خروج / وفاة / تبرع</th><th>الحالات المحدثة</th><th>وقت الاستلام</th><th>وفاة دماغية</th><th>ملاحظات</th><th>المطلوب</th><th>الختامي</th><th>الحالة</th><th></th></tr></thead><tbody>${rows.map(entryRow).join("")}</tbody><tfoot><tr><th>الإجمالي</th><th>${totals.carried}</th><th>—</th><th>${totals.newCases}</th><th>${totals.exits}</th><th>${totals.updated}</th><th>—</th><th>${totals.brain}</th><th>—</th><th>${totals.required}</th><th>${totals.closing}</th><th colspan="2">${rows.filter((x)=>x.r.reported).length} من ${rows.length} أرسل</th></tr></tfoot></table></div></section>`;
  }
  function entryRow({h,r,status}) {
    const v=raw(selectedDate,h.id);
    return `<tr data-hospital-row="${h.id}" class="${r.reported && !r.valid ? "row-error" : ""}"><td><strong>${esc(h.name)}</strong>${r.errors.length ? `<small class="error-text">${esc(r.errors.join("، "))}</small>`:""}</td><td>${r.carried}</td><td><input aria-label="تعديل الرصيد" type="number" min="0" step="1" data-record-field="balanceAdjustment" value="${v.balanceAdjustment ?? ""}"></td><td><input aria-label="بلاغات جديدة" type="number" min="0" step="1" data-record-field="newCases" value="${v.newCases ?? ""}"></td><td><input aria-label="خروج" type="number" min="0" step="1" data-record-field="exits" value="${v.exits ?? ""}"></td><td><input aria-label="الحالات المحدثة" type="number" min="0" step="1" data-record-field="updated" value="${v.updated ?? ""}"></td><td><div class="time-input"><input aria-label="وقت الاستلام" type="time" data-record-field="receivedAt" value="${v.receivedAt || ""}"><button title="الوقت الآن" data-now="${h.id}">الآن</button></div></td><td><input aria-label="وفاة دماغية" type="number" min="0" step="1" data-record-field="brainDeath" value="${v.brainDeath ?? ""}"></td><td><input aria-label="ملاحظات" type="text" data-record-field="notes" value="${esc(v.notes || "")}" placeholder="—"></td><td><strong>${r.required}</strong></td><td><strong>${r.closing}</strong></td><td>${badge(status)}</td><td>${r.required ? `<button data-all-updated="${h.id}">الكل محدث</button>`:`<button data-zero="${h.id}">إفادة صفرية</button>`}</td></tr>`;
  }

  function renderReport() {
    const day = dayRows(selectedDate); const month = monthSummary(selectedMonth);
    const toolbar=`<div class="toolbar no-print"><button class="${reportMode==="day"?"primary":""}" data-report-mode="day">تقرير اليوم — ${formatDate(selectedDate)}</button><button class="${reportMode==="month"?"primary":""}" data-report-mode="month">تقرير الشهر — ${monthLabel(selectedMonth)}</button><button data-action="print">طباعة / حفظ PDF</button></div>`;
    if(reportMode==="month") return `${toolbar}${reportHeader(monthLabel(selectedMonth))}${monthReportTable(month)}`;
    return `${toolbar}${reportHeader(formatDate(selectedDate))}<section class="report-kpis">${statCard("المستشفيات المستجيبة",`${day.filter(x=>x.r.reported).length} / ${day.length}`,"تقرير يومي")}${statCard("الحالات النشطة",day.reduce((s,x)=>s+x.r.closing,0),"الرصيد الختامي","blue")}${statCard("جاهزية الرفع",day.every(x=>x.r.reported)?"جاهز":"غير جاهز","يجب اكتمال جميع الإفادات",day.every(x=>x.r.reported)?"green":"red")}</section><section class="panel"><div class="table-wrap"><table><thead><tr><th>المستشفى</th><th>المطلوب</th><th>المحدث الفعلي</th><th>جديد</th><th>خروج</th><th>الختامي</th><th>الوقت</th><th>الحالة</th><th>الدرجة</th></tr></thead><tbody>${day.map(x=>`<tr><td><strong>${esc(x.h.name)}</strong></td><td>${x.r.required}</td><td>${x.r.effectiveUpdated}</td><td>${n(x.r.newCases)}</td><td>${n(x.r.exits)}</td><td>${x.r.closing}</td><td>${x.r.receivedAt||"—"}</td><td>${badge(x.status)}</td><td>${x.r.reported?grade(x.r.score):"0%"}</td></tr>`).join("")}</tbody></table></div></section>`;
  }
  function reportHeader(period){return `<section class="print-heading"><div class="brand-mark">ت</div><div><h2>متابعة الحالات الحرجة والوفاة الدماغية</h2><p>تجمع القصيم الصحي · تنسيق التبرع بالأعضاء</p></div><strong>${period}</strong></section>`;}
  function monthReportTable(summary){return `<section class="report-kpis">${statCard("نسبة الاستجابة",pct(summary.response),`${summary.sent} من ${summary.due}`)}${statCard("الإرسال في الوقت",pct(summary.punctuality),`${summary.ontime} تقرير`,"green")}${statCard("اكتمال التحديث",summary.completion===null?"—":pct(summary.completion),`${summary.updated} من ${summary.required}`,"blue")}${statCard("المؤشر العام",pct(summary.score),R.performanceLabel(summary.score,data.settings).label,"violet")}</section><section class="panel"><div class="table-wrap"><table><thead><tr><th>#</th><th>المستشفى</th><th>عبء الحالات</th><th>مستحق</th><th>أرسل</th><th>في الوقت</th><th>لم يرسل</th><th>الاستجابة</th><th>الاكتمال</th><th>المؤشر</th><th>نقاط الترتيب</th></tr></thead><tbody>${summary.hospitals.map((x,i)=>`<tr><td>${i+1}</td><td><strong>${esc(x.hospital.name)}</strong></td><td>${x.load}</td><td>${x.due}</td><td>${x.sent}</td><td>${x.ontime}</td><td>${x.counts.missed}</td><td>${pct(x.response)}</td><td>${x.completion===null?"—":pct(x.completion)}</td><td>${grade(x.score)}</td><td>${Math.round(x.rankingPoints)}${x.bonus?`<small> +${x.bonus.toFixed(1)}</small>`:""}</td></tr>`).join("")}</tbody></table></div></section>`;}

  function renderDashboard(){const m=monthSummary(selectedMonth); const dates=dateRangeForMonth(selectedMonth); const daily=dates.map(date=>{const rows=dayRows(date);const dueRows=rows.filter(x=>R.isDueDate(date,x.r,data.settings));return {day:Number(date.slice(-2)),sent:dueRows.filter(x=>x.r.reported).length,total:dueRows.length};}).filter(x=>x.total); return `${monthControls()}<section class="stats-grid">${statCard("نسبة الاستجابة",pct(m.response),`${m.sent} تقرير من ${m.due} مستحق`)}${statCard("الإرسال في الوقت",pct(m.punctuality),`حتى ${data.settings.fullUntil}`,"green")}${statCard("اكتمال تحديث الحالات",m.completion===null?"—":pct(m.completion),`${m.updated} من ${m.required}`,"blue")}${statCard("المؤشر العام",pct(m.score),R.performanceLabel(m.score,data.settings).label,"violet")}${statCard("بلاغات جديدة",m.hospitals.reduce((s,h)=>s+h.rows.reduce((a,x)=>a+n(x.r.newCases),0),0),"خلال الشهر","blue")}${statCard("خروج / وفاة / تبرع",m.hospitals.reduce((s,h)=>s+h.rows.reduce((a,x)=>a+n(x.r.exits),0),0),"خلال الشهر","red")}</section>${monthReportTable(m)}<section class="panel"><div class="panel-title"><h3>الاستجابة اليومية</h3><span>عدد المستشفيات</span></div><div class="bar-chart">${daily.map(x=>`<div><span>${x.sent}</span><i style="height:${x.total?x.sent/x.total*100:0}%"></i><small>${x.day}</small></div>`).join("")||"<p class='empty'>لا توجد أيام مستحقة في هذا الشهر.</p>"}</div></section>`;}

  function renderMonthly(){const dates=dateRangeForMonth(selectedMonth);const hospitals=activeHospitals();return `${monthControls()}<section class="legend">${["complete","zero","partial","late","afterDeadline","missed","pending","invalid"].map(s=>badge(s)).join("")}</section><section class="panel"><div class="panel-title"><h3>سجل الاستجابة يومًا بيوم</h3><span>اضغط على أي خانة لفتح إدخال ذلك اليوم</span></div><div class="table-wrap matrix"><table><thead><tr><th>المستشفى</th>${dates.map(d=>`<th>${Number(d.slice(-2))}<small>${dayNames[new Date(d+"T12:00:00").getDay()].slice(0,3)}</small></th>`).join("")}<th>لم يرسل</th><th>متأخر</th><th>المؤشر</th></tr></thead><tbody>${hospitals.map(h=>{const hm=hospitalMonth(h,selectedMonth);return `<tr><td><strong>${esc(h.name.replace(/^مستشفى |^مركز /,""))}</strong></td>${dates.map(date=>{const r=calc(date,h.id);let st=R.isDueDate(date,r,data.settings)?resolvedStatus(date,r):(date===R.isoDate()&&!r.reported?"pending":"future");const meta=R.statusMeta(st);return `<td><button class="matrix-cell ${statusClass[meta[2]]}" data-cell-date="${date}" title="${esc(meta[1])}">${meta[0]}</button></td>`;}).join("")}<td>${hm.counts.missed}</td><td>${hm.counts.late+hm.counts.afterDeadline}</td><td>${pct(hm.score)}</td></tr>`;}).join("")}</tbody></table></div></section>`;}

  function quarterControls(summary) {
    const options = activeHospitals().map((hospital) => `<option value="${hospital.id}" ${summary.hospitalId === hospital.id ? "selected" : ""}>${esc(hospital.name)}</option>`).join("");
    return `<div class="toolbar quarterly-toolbar no-print"><label>شهر البداية <input id="quarterStartPicker" type="month" value="${selectedQuarterStart}"></label><label>النطاق <select id="quarterHospitalPicker"><option value="all" ${summary.hospitalId === "all" ? "selected" : ""}>جميع المستشفيات</option>${options}</select></label><button class="soft" data-action="print">طباعة / PDF</button><button class="soft" data-action="quarter-export">تصدير Excel</button></div>`;
  }

  function renderQuarterly() {
    const summary = quarterlySummary();
    const endMonth = summary.months.at(-1);
    const selectedName = summary.hospitalId === "all" ? "جميع المستشفيات المحتسبة" : summary.hospitals[0]?.hospital.name;
    const metric = (value) => summary.due ? pct(value) : "—";
    const monthlyRows = summary.monthly.map((item) => `<tr><td><strong>${monthLabel(item.month)}</strong></td><td>${item.due}</td><td>${item.sent}</td><td>${item.due ? pct(item.response) : "—"}</td><td>${item.ontime}</td><td>${item.due ? pct(item.punctuality) : "—"}</td><td>${item.completion === null ? "—" : pct(item.completion)}</td><td>${item.due ? grade(item.score) : "—"}</td><td>${item.newCases}</td><td>${item.exits}</td><td>${item.brainDeath}</td></tr>`).join("");
    const hospitalRows = summary.hospitals.map((item) => `<tr><td>${item.rank}</td><td><strong>${esc(item.hospital.name)}</strong></td><td>${item.load}</td><td>${item.due}</td><td>${item.sent}</td><td>${item.due ? pct(item.response) : "—"}</td><td>${item.ontime}</td><td>${item.due ? pct(item.punctuality) : "—"}</td><td>${item.updated} / ${item.required}</td><td>${item.completion === null ? "—" : pct(item.completion)}</td><td>${item.newCases}</td><td>${item.exits}</td><td>${item.brainDeath}</td><td>${item.due ? grade(item.score) : "—"}</td><td>${item.due ? `${Math.round(item.rankingPoints)}${item.bonus ? `<small> +${item.bonus.toFixed(1)}</small>` : ""}` : "—"}</td></tr>`).join("");
    return `${quarterControls(summary)}<div class="notice quarterly-notice"><b>الفترة المختارة:</b> ${monthLabel(summary.startMonth)} — ${monthLabel(endMonth)} · ${esc(selectedName || "جميع المستشفيات")}<br><span>تُحتسب الأيام المستحقة حتى الآن فقط؛ اختيار يناير مثلًا يشمل يناير وفبراير ومارس.</span></div><section class="stats-grid">${statCard("نسبة الاستجابة",metric(summary.response),`${summary.sent} تقرير من ${summary.due} مستحق`)}${statCard("الإرسال في الوقت",metric(summary.punctuality),`${summary.ontime} تقرير حتى ${data.settings.fullUntil}`,"green")}${statCard("اكتمال التحديث",summary.completion === null ? "—" : pct(summary.completion),`${summary.updated} من ${summary.required} حالة×يوم`,"blue")}${statCard("المؤشر العام",metric(summary.score),summary.due ? R.performanceLabel(summary.score,data.settings).label : "لا توجد أيام مستحقة","violet")}${statCard("بلاغات جديدة",summary.newCases,"خلال الفترة","blue")}${statCard("وفاة دماغية",summary.brainDeath,`خروج/وفاة/تبرع: ${summary.exits}`,"red")}</section><section class="panel"><div class="panel-title"><h3>المقارنة الشهرية</h3><span>${summary.months.map(monthLabel).join(" · ")}</span></div><div class="table-wrap"><table><thead><tr><th>الشهر</th><th>مستحق</th><th>أرسل</th><th>الاستجابة</th><th>في الوقت</th><th>نسبة الالتزام بالوقت</th><th>اكتمال التحديث</th><th>المؤشر</th><th>بلاغات جديدة</th><th>خروج/وفاة/تبرع</th><th>وفاة دماغية</th></tr></thead><tbody>${monthlyRows}</tbody></table></div></section><section class="panel"><div class="panel-title"><h3>ملخص المستشفيات خلال الفترة</h3><span>الترتيب يشمل ميزة عبء الحالات من الإعدادات</span></div><div class="table-wrap"><table><thead><tr><th>#</th><th>المستشفى</th><th>عبء الحالات</th><th>مستحق</th><th>أرسل</th><th>الاستجابة</th><th>في الوقت</th><th>الالتزام بالوقت</th><th>المحدث / المطلوب</th><th>الاكتمال</th><th>جديد</th><th>خروج</th><th>وفاة دماغية</th><th>المؤشر</th><th>نقاط الترتيب</th></tr></thead><tbody>${hospitalRows || `<tr><td colspan="15" class="empty">لا توجد مستشفيات محتسبة.</td></tr>`}</tbody></table></div></section><section class="panel"><div class="panel-title"><h3>اتجاه المؤشر في الأشهر الثلاثة</h3></div><div class="line-cards quarterly-lines">${summary.monthly.map((item) => `<div><span>${monthLabel(item.month)}</span><strong>${item.due ? pct(item.score) : "—"}</strong><progress max="100" value="${item.due ? item.score : 0}"></progress><small>${item.sent} من ${item.due} تقرير</small></div>`).join("")}</div></section>`;
  }

  function violationRows(){return monthSummary(selectedMonth).hospitals.map(hm=>{const counts=hm.counts;const level=R.escalation({missed:counts.missed,late:counts.late+counts.afterDeadline,partial:counts.partial,invalid:counts.invalid},data.settings);return {...hm,level,total:Object.values(counts).reduce((a,b)=>a+b,0)};});}
  function renderViolations(){const rows=violationRows();const total=rows.reduce((s,x)=>s+x.total,0);const needs=rows.filter(x=>x.level>0).length;const details=rows.flatMap(x=>x.rows.filter(r=>["missed","late","afterDeadline","partial","invalid"].includes(r.status)).map(r=>({h:x.hospital,date:r.date,...r})));return `${monthControls()}<section class="stats-grid">${statCard("إجمالي المخالفات",total,monthLabel(selectedMonth),"red")}${statCard("مستشفيات تحتاج متابعة",`${needs} / ${rows.length}`,"المستوى 1 فأعلى","amber")}${statCard("المستوى 2 (خطاب تنبيه)",rows.filter(x=>x.level===2).length,"حسب حدود الإعدادات","blue")}${statCard("المستوى 3 (تصعيد)",rows.filter(x=>x.level===3).length,"يتطلب خطة تصحيحية","red")}</section><section class="panel"><div class="panel-title"><h3>ملخص المخالفات حسب المستشفى</h3><span>حدود المستويات من الإعدادات</span></div><div class="table-wrap"><table><thead><tr><th>المستشفى</th><th>لم يرسل</th><th>بعد الموعد</th><th>متأخر</th><th>جزئي</th><th>خطأ</th><th>الإجمالي</th><th>المستوى</th><th>الإجراء</th></tr></thead><tbody>${rows.map(x=>`<tr><td><strong>${esc(x.hospital.name)}</strong></td><td>${x.counts.missed}</td><td>${x.counts.afterDeadline}</td><td>${x.counts.late}</td><td>${x.counts.partial}</td><td>${x.counts.invalid}</td><td>${x.total}</td><td>${x.level?`المستوى ${x.level}`:"ملتزم"}</td><td>${x.level===3?"تصعيد مع خطة تصحيحية":x.level===2?"خطاب تنبيه":x.level===1?"تذكير ومتابعة":"لا إجراء"}</td></tr>`).join("")}</tbody></table></div></section><section class="panel"><div class="panel-title"><h3>تفاصيل المخالفات</h3><span>العدد: ${details.length}</span></div><div class="table-wrap"><table><thead><tr><th>التاريخ</th><th>المستشفى</th><th>الحالة</th><th>المطلوب</th><th>المحدث الفعلي</th><th>الوقت</th><th>الدرجة</th><th></th></tr></thead><tbody>${details.map(x=>`<tr><td>${formatDate(x.date)}</td><td>${esc(x.h.name)}</td><td>${badge(x.status)}</td><td>${x.r.required}</td><td>${x.r.effectiveUpdated}</td><td>${x.r.receivedAt||"—"}</td><td>${pct(x.r.score)}</td><td><button data-cell-date="${x.date}">فتح اليوم</button></td></tr>`).join("")||`<tr><td colspan="8" class="empty">لا توجد مخالفات في هذا الشهر.</td></tr>`}</tbody></table></div></section>`;}

  function renderAnnual(){const hospitals=activeHospitals();const months=Array.from({length:12},(_,i)=>`${selectedYear}-${String(i+1).padStart(2,"0")}`);const hospitalRows=hospitals.map(h=>{const ms=months.map(m=>hospitalMonth(h,m));const due=ms.reduce((s,x)=>s+x.due,0);const avg=due?ms.reduce((s,x)=>s+x.score*x.due,0)/due:0;const sent=ms.reduce((s,x)=>s+x.sent,0);return {h,ms,due,avg,response:due?sent/due*100:0};}).sort((a,b)=>b.avg-a.avg);const cluster=months.map(m=>monthSummary(m));return `${yearControls()}<section class="panel"><div class="panel-title"><h3>المؤشر الشهري لكل مستشفى</h3><span>متوسط الدرجات اليومية؛ اليوم الذي لم يُرسل فيه تقرير يُحتسب صفرًا</span></div><div class="table-wrap"><table><thead><tr><th>المستشفى</th>${months.map((_,i)=>`<th>${monthNames[i]}</th>`).join("")}<th>التراكمي</th><th>الاستجابة</th><th>الترتيب</th></tr></thead><tbody>${hospitalRows.map((x,i)=>`<tr><td><strong>${esc(x.h.name)}</strong></td>${x.ms.map(m=>`<td>${m.due?pct(m.score):"—"}</td>`).join("")}<td>${x.due?pct(x.avg):"—"}</td><td>${x.due?pct(x.response):"—"}</td><td>${i+1}</td></tr>`).join("")}<tr class="total"><th>مؤشر التجمع</th>${cluster.map(m=>`<th>${m.due?pct(m.score):"—"}</th>`).join("")}<th colspan="3">—</th></tr></tbody></table></div></section><section class="panel"><div class="panel-title"><h3>اتجاه مؤشرات التجمع</h3></div><div class="line-cards">${cluster.map((m,i)=>`<div><span>${monthNames[i]}</span><strong>${m.due?pct(m.score):"—"}</strong><progress max="100" value="${m.due?m.score:0}"></progress></div>`).join("")}</div></section>`;}

  function renderSettings(){const s=data.settings;return `<form id="settingsForm"><section class="panel settings-section"><div class="panel-title"><h3>عناصر الدرجة اليومية</h3><span>تُوزّع الأوزان تلقائيًا على العناصر المختارة</span></div>${settingWeight("report","إرسال التقرير اليومي","وصول رد المستشفى في ذلك اليوم.")}${settingWeight("completion","اكتمال تحديث الحالات","المحدث الفعلي ÷ المطلوب؛ الإفادة الصفرية مكتملة.")}${settingWeight("accuracy","صحة البيانات","أرقام متسقة ووقت استلام صحيح.")}</section><section class="panel settings-grid"><div><h3>وقت التحديث والخصم</h3><label>الدرجة كاملة حتى<input name="fullUntil" type="time" value="${s.fullUntil}"></label><label>الموعد النهائي<input name="deadline" type="time" value="${s.deadline}"></label><label class="check"><input name="gradualPenalty" type="checkbox" ${s.gradualPenalty?"checked":""}> خصم تدريجي بين الوقتين</label><div class="timeline"><span>100%<small>${s.fullUntil}</small></span><span>50%<small>منتصف المدة</small></span><span>0%<small>${s.deadline}</small></span></div></div><div><h3>عام والتواصل</h3><label>تاريخ بدء المتابعة<input name="startDate" type="date" value="${s.startDate}"></label><label>التوقيع<input name="signature" value="${esc(s.signature)}"></label><label>رابط مجموعة الواتساب<input name="whatsappGroup" value="${esc(s.whatsappGroup)}" placeholder="https://chat.whatsapp.com/..."></label></div></section><section class="panel settings-grid"><div><h3>التقييم</h3><label>ممتاز إذا ≥ %<input name="excellentAt" type="number" min="0" max="100" value="${s.excellentAt}"></label><label>مقبول إذا ≥ %<input name="acceptableAt" type="number" min="0" max="100" value="${s.acceptableAt}"></label><label class="check"><input name="caseLoadBonusEnabled" type="checkbox" ${s.caseLoadBonusEnabled?"checked":""}> ميزة حجم الحالات في الترتيب</label><label>أقصى ميزة %<input name="maxCaseLoadBonus" type="number" min="0" max="50" value="${s.maxCaseLoadBonus}"></label></div><div><h3>التصعيد</h3><label>المستوى 2: عدم إرسال ≥<input name="escalation2Missed" type="number" min="1" value="${s.escalation2Missed}"></label><label>المستوى 2: تأخر ≥<input name="escalation2Late" type="number" min="1" value="${s.escalation2Late}"></label><label>المستوى 3: عدم إرسال ≥<input name="escalation3Missed" type="number" min="1" value="${s.escalation3Missed}"></label><label>المستوى 3: تأخر ≥<input name="escalation3Late" type="number" min="1" value="${s.escalation3Late}"></label></div></section><section class="panel"><div class="panel-title"><h3>المستشفيات وجهات التواصل</h3><button type="button" data-action="add-hospital">إضافة مستشفى</button></div><div class="table-wrap"><table class="hospital-settings"><thead><tr><th>الترتيب</th><th>اسم المستشفى</th><th>منسق المستشفى</th><th>رقم التواصل</th><th>محتسب</th></tr></thead><tbody>${data.hospitals.map((h,i)=>`<tr data-setting-hospital="${h.id}"><td><button type="button" data-move="up" ${i===0?"disabled":""}>▲</button><button type="button" data-move="down" ${i===data.hospitals.length-1?"disabled":""}>▼</button></td><td><input data-hospital-field="name" value="${esc(h.name)}"></td><td><input data-hospital-field="coordinator" value="${esc(h.coordinator)}" placeholder="الاسم"></td><td><input data-hospital-field="phone" value="${esc(h.phone)}" placeholder="05xxxxxxxx"></td><td><input data-hospital-field="active" type="checkbox" ${h.active?"checked":""}></td></tr>`).join("")}</tbody></table></div><div class="form-actions"><button class="primary" type="submit">حفظ الإعدادات</button><button type="button" data-action="reset-settings">إعادة الإعدادات الافتراضية</button></div></section></form>`;}
  function settingWeight(key,title,desc){return `<div class="weight-row"><input aria-label="${title}" name="enabled.${key}" type="checkbox" ${data.settings.enabled[key]?"checked":""}><div><strong>${title}</strong><small>${desc}</small></div><input name="weights.${key}" type="number" min="0" max="100" value="${data.settings.weights[key]}"><b>%</b></div>`;}

  function recordsList(){return Object.entries(data.records).filter(([,r])=>Object.values(r).some(R.hasValue));}
  function renderBackup(){const list=recordsList();const dates=[...new Set(list.map(([k])=>k.split("::")[0]))].sort();const cloud=S.status().mode!=="local";const storageNotice=cloud?"<b>● البيانات متزامنة مع Neon:</b> تبقى نسخة مؤقتة على هذا الجهاز للعمل عند انقطاع الاتصال. صدّر نسخة احتياطية دوريًا.":"<b>● البيانات محفوظة محليًا:</b> لا تُرسل لأي خادم. صدّر نسخة احتياطية أسبوعيًا، واستخدمها لنقل البيانات إلى جهاز آخر.";return `${monthControls()}<div class="notice storage-notice">${storageNotice}</div><section class="stats-grid backup-stats">${statCard("أيام مُدخلة",dates.length,dates.length?`${formatDate(dates[0])} — ${formatDate(dates.at(-1))}`:"لا توجد بيانات")}${statCard("صفوف مُدخلة",list.length,"مستشفى × يوم","blue")}${statCard("المستشفيات المحتسبة",activeHospitals().length,`من ${data.hospitals.length}`,"green")}${statCard("بداية المتابعة",formatDate(data.settings.startDate),`الدرجة كاملة حتى ${data.settings.fullUntil} — صفر عند ${data.settings.deadline}`,"violet")}</section><section class="backup-grid"><article class="panel"><h3>تصدير</h3><div class="export-actions"><div class="export-row"><div><h4>تقرير Excel</h4><p>ملف حقيقي متعدد الأوراق: ملخص الشهر، السجل الكامل، القواعد والإعدادات، والمستشفيات.</p></div><button class="primary" data-action="export-excel">تنزيل Excel</button></div><div class="export-row"><div><h4>Google Sheets</h4><p>ينزّل التقرير المتوافق ويفتح Google Sheets لاستيراده مع جميع الأوراق والنِسَب.</p></div><button class="google-button" data-action="google-sheets">فتح في Google Sheets</button></div><div class="export-row"><div><h4>نسخة احتياطية</h4><p>ملف واحد يحفظ كل البيانات والإعدادات لاستعادتها لاحقًا أو على جهاز آخر.</p></div><button data-action="export-backup">تنزيل نسخة احتياطية</button></div></div></article><article class="panel"><h3>استيراد</h3><div class="export-actions"><div class="export-row"><div><h4>من ملف CSV سابق</h4><p>يضيف الصفوف ويستبدل بيانات اليوم والمستشفى المطابقين فقط.</p></div><label class="file-button">اختيار ملف CSV<input hidden id="csvImport" type="file" accept=".csv,text/csv"></label></div><div class="export-row"><div><h4>استعادة نسخة احتياطية</h4><p>تحل محل جميع البيانات والإعدادات الحالية وتُزامنها مع Neon عند الاتصال.</p></div><label class="file-button soft-file">اختيار النسخة<input hidden id="backupImport" type="file" accept=".json,application/json"></label></div></div></article></section><section class="panel danger-zone delete-panel"><div><h3>حذف البيانات</h3><p>يحذف جميع الإدخالات ${cloud?"من قاعدة Neon ومن النسخة المحلية":"من هذا الجهاز"} مع إبقاء الإعدادات والمستشفيات. صدّر نسخة احتياطية أولًا.</p></div><button data-action="clear-records">حذف كل الإدخالات</button></section>`;}

  function renderGuide(){const states=[["complete","أُرسل حتى الوقت الكامل وحُدّثت جميع الحالات."],["zero","لا توجد حالات وأُرسلت الإفادة في الوقت."],["partial","أُرسل لكن بعض الحالات لم تُحدّث."],["late",`وصل بعد ${data.settings.fullUntil} وحتى ${data.settings.deadline} ويطبق الخصم التدريجي.`],["afterDeadline",`وصل بعد ${data.settings.deadline} ودرجة اليوم صفر.`],["missed","لا يوجد أي إدخال بعد انتهاء الموعد."],["pending","لم يصل بعد وما زال قبل الموعد النهائي."],["invalid","وقت مفقود أو أرقام غير متسقة."]];return `<section class="guide-grid"><article class="panel"><h3>العمل اليومي للمنسق</h3><ol><li>افتح «إدخال البيانات» على تاريخ اليوم.</li><li>أدخل البلاغات الجديدة والخروج/الوفاة/التبرع والمحدث ووقت الاستلام.</li><li>عند عدم وجود حالات، استخدم «إفادة صفرية».</li><li>تابع المتأخرين من «متابعة اليوم» وانسخ رسائل التذكير.</li><li>اطبع «تقرير الحالة» بصيغة PDF عند اكتمال الإفادات.</li><li>راجع المخالفات والتصعيد شهريًا، وصدّر نسخة احتياطية أسبوعيًا.</li><li>من «ملخص ثلاثة أشهر» اختر شهر البداية وجميع المستشفيات أو مستشفى واحدًا، ثم اطبع أو صدّر Excel.</li></ol></article><article class="panel"><h3>قواعد الحساب الدقيقة</h3><ul><li><b>المرحّل:</b> الرصيد الختامي لآخر يوم سابق لنفس المستشفى.</li><li><b>تعديل الرصيد:</b> يحل محل المرحّل عند اختلاف العدد الفعلي.</li><li><b>المطلوب:</b> الرصيد المرحّل/المعدّل فقط؛ البلاغ الجديد يصبح مطلوبًا غدًا.</li><li><b>المحدث الفعلي:</b> عدد الحالات المحدثة فقط، وبحد أقصى المطلوب؛ الخروج لا يُضاف إليه.</li><li><b>الختامي:</b> الرصيد الافتتاحي + البلاغات الجديدة − الخروج.</li><li><b>الدرجة:</b> إرسال التقرير 40% + اكتمال الحالات 40% + صحة البيانات 20%، ثم تضرب في معامل الوقت.</li><li><b>المؤشر الشهري:</b> متوسط الدرجات اليومية المستحقة، وعدم الإرسال = صفر.</li><li><b>ملخص ثلاثة أشهر:</b> الشهر المختار مع الشهرين التاليين، ومؤشره متوسط موزون بعدد الأيام المستحقة.</li></ul></article></section><section class="panel"><h3>حالات الاستجابة</h3><div class="state-list">${states.map(([s,d])=>`<div>${badge(s)}<p>${d}</p></div>`).join("")}</div></section>`;}

  function content(){return ({today:renderToday,report:renderReport,entry:renderEntry,dashboard:renderDashboard,monthly:renderMonthly,quarterly:renderQuarterly,violations:renderViolations,annual:renderAnnual,settings:renderSettings,backup:renderBackup,guide:renderGuide})[view]();}
  function render(){
    if (!accessGranted) return;
    const [title,subtitle]=viewTitles[view];
    document.querySelectorAll("[data-nav]").forEach(a=>a.classList.toggle("active",a.dataset.nav===view));
    document.getElementById("pageTitle").textContent=title;
    document.getElementById("pageSubtitle").textContent=subtitle;
    app.innerHTML=content();
    const pageTools=document.getElementById("pageTools");
    if(pageTools){pageTools.replaceChildren();const toolbar=app.querySelector(":scope > .toolbar");if(toolbar)pageTools.appendChild(toolbar);}
    const lastEntry=document.getElementById("lastEntry");
    if(lastEntry){const dates=recordsList().map(([key])=>key.split("::")[0]).sort();lastEntry.innerHTML=`<span class="dot"></span> آخر إدخال: ${dates.length?formatDate(dates.at(-1)):"لا يوجد"}`;}
    bindViewEvents();
    window.scrollTo({top:0,behavior:"auto"});
  }

  function saveSettingForm(form){const fd=new FormData(form);["report","completion","accuracy"].forEach(k=>{data.settings.enabled[k]=fd.has(`enabled.${k}`);data.settings.weights[k]=n(fd.get(`weights.${k}`));});["fullUntil","deadline","startDate","signature","whatsappGroup"].forEach(k=>data.settings[k]=String(fd.get(k)||""));["excellentAt","acceptableAt","escalation2Missed","escalation2Late","escalation3Missed","escalation3Late","maxCaseLoadBonus"].forEach(k=>data.settings[k]=n(fd.get(k)));data.settings.gradualPenalty=fd.has("gradualPenalty");data.settings.caseLoadBonusEnabled=fd.has("caseLoadBonusEnabled");document.querySelectorAll("[data-setting-hospital]").forEach(row=>{const h=data.hospitals.find(x=>x.id===row.dataset.settingHospital);row.querySelectorAll("[data-hospital-field]").forEach(input=>{h[input.dataset.hospitalField]=input.type==="checkbox"?input.checked:input.value.trim();});});S.save(data);toast("تم حفظ الإعدادات");render();}

  function bindViewEvents(){
    document.querySelectorAll("[data-view]").forEach(el=>el.addEventListener("click",()=>{view=el.dataset.view;render();}));
    document.querySelectorAll("[data-date-step]").forEach(el=>el.addEventListener("click",()=>{const step=Number(el.getAttribute("data-date-step"));const d=new Date(`${selectedDate}T12:00:00`);d.setDate(d.getDate()+step);selectedDate=R.isoDate(d);selectedMonth=selectedDate.slice(0,7);render();}));
    document.getElementById("datePicker")?.addEventListener("change",e=>{selectedDate=e.target.value;selectedMonth=selectedDate.slice(0,7);render();});
    document.getElementById("monthPicker")?.addEventListener("change",e=>{selectedMonth=e.target.value;render();});
    document.getElementById("yearPicker")?.addEventListener("change",e=>{selectedYear=e.target.value;render();});
    document.getElementById("quarterStartPicker")?.addEventListener("change",e=>{if(e.target.value){selectedQuarterStart=e.target.value;render();}});
    document.getElementById("quarterHospitalPicker")?.addEventListener("change",e=>{selectedQuarterHospital=e.target.value;render();});
    document.querySelectorAll("[data-action='print']").forEach(el=>el.addEventListener("click",()=>window.print()));
    document.querySelectorAll("[data-action='month-report']").forEach(el=>el.addEventListener("click",()=>{reportMode="month";view="report";render();}));
    document.querySelectorAll("[data-report-mode]").forEach(el=>el.addEventListener("click",()=>{reportMode=el.dataset.reportMode;render();}));
    document.querySelectorAll("[data-open-entry]").forEach(el=>el.addEventListener("click",()=>{view="entry";render();setTimeout(()=>document.querySelector(`[data-hospital-row='${el.dataset.openEntry}']`)?.scrollIntoView({behavior:"smooth",block:"center"}),30);}));
    document.querySelectorAll("[data-cell-date]").forEach(el=>el.addEventListener("click",()=>{selectedDate=el.dataset.cellDate;selectedMonth=selectedDate.slice(0,7);view="entry";render();}));
    document.querySelectorAll("[data-record-field]").forEach(el=>{
      const persist=()=>{const row=el.closest("[data-hospital-row]");let value=el.value;if(el.type==="number"&&value!=="")value=Math.max(0,Math.floor(Number(value)));S.saveRecord(data,selectedDate,row.dataset.hospitalRow,{[el.dataset.recordField]:value});};
      el.addEventListener("input",persist);
      el.addEventListener("change",()=>{persist();render();});
    });
    document.querySelectorAll("[data-now]").forEach(el=>el.addEventListener("click",()=>{S.saveRecord(data,selectedDate,el.dataset.now,{receivedAt:nowTime()});render();}));
    document.querySelectorAll("[data-all-updated]").forEach(el=>el.addEventListener("click",()=>{const r=calc(selectedDate,el.dataset.allUpdated);S.saveRecord(data,selectedDate,el.dataset.allUpdated,{updated:r.required,receivedAt:raw(selectedDate,el.dataset.allUpdated).receivedAt||nowTime()});render();}));
    document.querySelectorAll("[data-zero]").forEach(el=>el.addEventListener("click",()=>{S.saveRecord(data,selectedDate,el.dataset.zero,{updated:0,receivedAt:nowTime()});render();}));
    document.querySelectorAll("[data-reminded]").forEach(el=>el.addEventListener("change",()=>{data.reminders[R.recordKey(selectedDate,el.dataset.reminded)]=el.checked;S.save(data);}));
    document.querySelector("[data-copy='group-reminder']")?.addEventListener("click",()=>copyText(reminderMessage(dayRows(selectedDate),null)));
    document.querySelector("[data-copy='summary']")?.addEventListener("click",()=>copyText(document.getElementById("summaryText").textContent));
    document.querySelectorAll("[data-copy-hospital]").forEach(el=>el.addEventListener("click",()=>{const row=dayRows(selectedDate).find(x=>x.h.id===el.dataset.copyHospital);copyText(reminderMessage(dayRows(selectedDate),row));}));
    document.getElementById("settingsForm")?.addEventListener("submit",e=>{e.preventDefault();saveSettingForm(e.currentTarget);});
    document.querySelector("[data-action='add-hospital']")?.addEventListener("click",()=>{S.addHospital(data);render();});
    document.querySelectorAll("[data-move]").forEach(el=>el.addEventListener("click",()=>{const id=el.closest("tr").dataset.settingHospital;const i=data.hospitals.findIndex(h=>h.id===id);const j=el.dataset.move==="up"?i-1:i+1;if(j>=0&&j<data.hospitals.length){[data.hospitals[i],data.hospitals[j]]=[data.hospitals[j],data.hospitals[i]];S.save(data);render();}}));
    document.querySelector("[data-action='reset-settings']")?.addEventListener("click",()=>{if(confirm("إعادة قواعد التقييم والوقت إلى القيم الافتراضية؟")){data.settings=JSON.parse(JSON.stringify(R.DEFAULT_SETTINGS));S.save(data);render();}});
    document.querySelector("[data-action='export-backup']")?.addEventListener("click",()=>download(`نسخة-احتياطية-${R.isoDate()}.json`,S.exportBackup(data),"application/json;charset=utf-8"));
    document.querySelector("[data-action='export-excel']")?.addEventListener("click",exportExcel);
    document.querySelector("[data-action='quarter-export']")?.addEventListener("click",exportQuarterExcel);
    document.querySelector("[data-action='google-sheets']")?.addEventListener("click",openGoogleSheets);
    document.querySelector("[data-action='clear-records']")?.addEventListener("click",()=>{const target=S.status().mode==="local"?"هذا المتصفح":"قاعدة Neon وكل الأجهزة المتصلة";if(confirm(`سيتم حذف جميع الإدخالات نهائيًا من ${target}. هل أنت متأكد؟`)){S.clearRecords(data);toast("تم حذف الإدخالات");render();}});
    document.querySelector("[data-action='demo-data']")?.addEventListener("click",()=>{if(confirm("إضافة بيانات تجريبية متنوعة إلى الشهر الحالي؟")){loadDemo();toast("تم تحميل البيانات التجريبية");render();}});
    document.getElementById("backupImport")?.addEventListener("change",importBackupFile);
    document.getElementById("csvImport")?.addEventListener("change",importCsvFile);
  }

  function cell(value,style=X?.STYLE.normal,type){return {value,style,type};}
  function percentCell(value){return value===null||value===undefined?cell("—",X.STYLE.muted):cell(value/100,X.STYLE.percent);}
  function hasRawData(record){return Object.values(record||{}).some(R.hasValue);}
  function exportDates(){
    const recorded=Object.keys(data.records).map((key)=>key.split("::")[0]).filter(Boolean).sort();
    const today=R.isoDate();
    const end=[today,recorded.at(-1)||data.settings.startDate].sort().at(-1);
    const dates=[];
    for(let date=data.settings.startDate;date<=end;date=R.addDays(date,1))dates.push(date);
    return dates;
  }
  function workbookSheets(){
    if(!X)throw new Error("مكوّن Excel غير محمّل");
    const ST=X.STYLE;
    const summary=monthSummary(selectedMonth);
    const summaryHeader=["الترتيب","المستشفى","عبء الحالات","نقاط الترتيب","أيام مستحقة","أرسل","في الوقت","متأخر","بعد الموعد النهائي","لم يرسل","تحديث جزئي","خطأ بيانات","نسبة الاستجابة","الإرسال في الوقت","اكتمال التحديث","المؤشر","التقييم","مستوى التصعيد"];
    const summaryRows=[
      [cell("متابعة الحالات الحرجة والوفاة الدماغية — تجمع القصيم الصحي",ST.title)],
      [cell(`ملخص ${monthLabel(selectedMonth)} · أُنشئ ${formatDate(R.isoDate())} ${nowTime()}`,ST.section)],
      [],
      [cell("نسبة الاستجابة",ST.section),cell("الإرسال في الوقت",ST.section),cell("اكتمال التحديث",ST.section),cell("المؤشر العام",ST.section)],
      [percentCell(summary.response),percentCell(summary.punctuality),percentCell(summary.completion),percentCell(summary.score)],
      [],
      summaryHeader.map((value)=>cell(value,ST.header)),
    ];
    summary.hospitals.forEach((item,index)=>{
      const late=item.sent-item.ontime;
      const level=R.escalation({missed:item.counts.missed,late:item.counts.late+item.counts.afterDeadline,partial:item.counts.partial,invalid:item.counts.invalid},data.settings);
      summaryRows.push([
        item.due?index+1:"",item.hospital.name,item.load,Math.round(item.rankingPoints),item.due,item.sent,item.ontime,late,item.counts.afterDeadline,item.counts.missed,item.counts.partial,item.counts.invalid,
        percentCell(item.response),percentCell(item.punctuality),percentCell(item.completion),percentCell(item.score),R.performanceLabel(item.score,data.settings).label,level?`المستوى ${level}`:"لا يوجد",
      ]);
    });
    const totals=summary.hospitals.reduce((acc,item)=>{acc.load+=item.load;acc.late+=item.sent-item.ontime;Object.keys(acc.counts).forEach((key)=>acc.counts[key]+=item.counts[key]||0);return acc;},{load:0,late:0,counts:{afterDeadline:0,missed:0,partial:0,invalid:0}});
    summaryRows.push([cell("",ST.section),cell("إجمالي التجمع",ST.section),cell(totals.load,ST.section),cell("",ST.section),cell(summary.due,ST.section),cell(summary.sent,ST.section),cell(summary.ontime,ST.section),cell(totals.late,ST.section),cell(totals.counts.afterDeadline,ST.section),cell(totals.counts.missed,ST.section),cell(totals.counts.partial,ST.section),cell(totals.counts.invalid,ST.section),percentCell(summary.response),percentCell(summary.punctuality),percentCell(summary.completion),percentCell(summary.score),cell(R.performanceLabel(summary.score,data.settings).label,ST.section),cell("—",ST.section)]);

    const logHeader=["التاريخ","اليوم","المستشفى","الرصيد المرحّل","تعديل الرصيد","بلاغات جديدة","خروج / وفاة / تبرع","الحالات المحدثة","وقت الاستلام","وفاة دماغية","ملاحظات","المطلوب تحديثه","الرصيد الختامي","حالة الاستجابة","الدرجة اليومية"];
    const logRows=[
      [cell("السجل الكامل للحالات والدرجات",ST.title)],
      [cell(`من ${formatDate(data.settings.startDate)} حتى ${formatDate(exportDates().at(-1)||data.settings.startDate)}`,ST.section)],
      [],
      logHeader.map((value)=>cell(value,ST.header)),
    ];
    exportDates().forEach((date)=>data.hospitals.forEach((hospital)=>{
      const source=raw(date,hospital.id);
      const result=calc(date,hospital.id);
      const due=R.isDueDate(date,result,data.settings);
      if((!hospital.active||!due)&&!hasRawData(source))return;
      const status=resolvedStatus(date,result);
      const tone=statusClass[R.statusMeta(status)[2]];
      const statusStyle=tone==="success"?ST.success:tone==="warning"?ST.warning:tone==="danger"?ST.danger:ST.muted;
      const rawNumber=(key)=>R.hasValue(source[key])?n(source[key]):"";
      logRows.push([
        cell(date,ST.date,"date"),dayNames[new Date(`${date}T12:00:00`).getDay()],hospital.name,result.carried,R.hasValue(source.balanceAdjustment)?n(source.balanceAdjustment):"",rawNumber("newCases"),rawNumber("exits"),rawNumber("updated"),
        R.hasValue(source.receivedAt)?cell(source.receivedAt,ST.time,"time"):"",rawNumber("brainDeath"),source.notes||"",result.required,result.closing,cell(R.statusMeta(status)[1],statusStyle),cell((due||result.reported)?result.score/100:"",ST.percent),
      ]);
    }));

    const settingsRows=[
      [cell("القواعد والإعدادات المطبقة عند التصدير",ST.title)],
      [cell("هذه القيم هي المصدر نفسه الذي تستخدمه لوحة المؤشرات والحسابات اليومية.",ST.section)],
      [],
      [cell("الفئة",ST.header),cell("الإعداد",ST.header),cell("القيمة",ST.header),cell("طريقة الاحتساب",ST.header)],
      ["الدرجة","إرسال التقرير اليومي",cell(data.settings.weights.report/100,ST.percent),data.settings.enabled.report?"مفعّل؛ تُعاد موازنة الأوزان المفعلة":"غير مفعّل"],
      ["الدرجة","اكتمال تحديث الحالات",cell(data.settings.weights.completion/100,ST.percent),data.settings.enabled.completion?"المحدث ÷ المطلوب، وبحد أقصى 100%":"غير مفعّل"],
      ["الدرجة","صحة البيانات",cell(data.settings.weights.accuracy/100,ST.percent),data.settings.enabled.accuracy?"كامل عند اتساق الأرقام ووجود وقت صحيح":"غير مفعّل"],
      ["الدرجة","إعادة موازنة الأوزان","تلقائية","تُقسّم أوزان العناصر المفعّلة على مجموعها؛ وعند تعطيلها كلها تعتمد الدرجة على الوقت فقط"],
      ["الوقت","الدرجة كاملة حتى",cell(data.settings.fullUntil,ST.time,"time"),"معامل الوقت 100% حتى هذا الوقت"],
      ["الوقت","الموعد النهائي",cell(data.settings.deadline,ST.time,"time"),data.settings.gradualPenalty?"خصم خطي حتى يصل المعامل إلى صفر":"لا خصم تدريجي؛ بعد الموعد صفر"],
      ["الاستجابة","تعريف «أرسل»","—","وجود قيمة في البلاغات الجديدة أو الخروج أو المحدث، أو وجود وقت استلام صحيح"],
      ["التحقق","وقت الاستلام","إلزامي عند الإرسال","المطلوب أكبر من صفر يستلزم إدخال عدد الحالات المحدثة"],
      ["التحقق","اتساق الأرقام","—","الخروج والوفاة الدماغية لا يتجاوزان المتاح، والمحدث لا يتجاوز المطلوب"],
      ["الفترة","تاريخ بداية المتابعة",cell(data.settings.startDate,ST.date,"date"),"الأيام السابقة لا تدخل في المؤشرات"],
      ["التقييم","ممتاز إذا",cell(data.settings.excellentAt/100,ST.percent),"حد اللون الأخضر"],
      ["التقييم","مقبول إذا",cell(data.settings.acceptableAt/100,ST.percent),"حد اللون الأصفر"],
      ["الترتيب","أقصى ميزة لعبء الحالات",cell(data.settings.maxCaseLoadBonus/100,ST.percent),data.settings.caseLoadBonusEnabled?"تضاف لنقاط الترتيب فقط":"غير مفعّلة"],
      ["التصعيد","المستوى 2 — عدم إرسال",data.settings.escalation2Missed,"عدد الأيام"],
      ["التصعيد","المستوى 2 — تأخر",data.settings.escalation2Late,"عدد الأيام"],
      ["التصعيد","المستوى 3 — عدم إرسال",data.settings.escalation3Missed,"عدد الأيام"],
      ["التصعيد","المستوى 3 — تأخر",data.settings.escalation3Late,"عدد الأيام"],
      ["الرصيد","الرصيد الختامي","—","الرصيد الافتتاحي + البلاغات الجديدة − الخروج"],
      ["الرصيد","المطلوب تحديثه","—","الرصيد المرحّل أو تعديل الرصيد؛ البلاغ الجديد يصبح مطلوبًا في اليوم التالي"],
      ["المؤشر","الإرسال في الوقت","—","عدد التقارير المستلمة حتى وقت الدرجة الكاملة ÷ جميع الأيام المستحقة"],
      ["المؤشر","اكتمال التحديث","—","إجمالي المحدث الفعلي ÷ إجمالي المطلوب؛ الخروج لا يُضاف إلى المحدث"],
      ["المؤشر","المؤشر الشهري","—","متوسط الدرجات اليومية المستحقة؛ عدم الإرسال يساوي صفرًا"],
    ];

    const hospitalsRows=[
      [cell("المستشفيات وجهات التواصل",ST.title)],
      [cell(`المحتسب حاليًا: ${activeHospitals().length} من ${data.hospitals.length}`,ST.section)],
      [],
      [cell("الترتيب",ST.header),cell("اسم المستشفى",ST.header),cell("منسق المستشفى",ST.header),cell("رقم التواصل",ST.header),cell("الحالة",ST.header)],
      ...data.hospitals.map((hospital,index)=>[index+1,hospital.name,hospital.coordinator||"",hospital.phone||"",cell(hospital.active?"محتسب":"مخفي",hospital.active?ST.success:ST.muted)]),
    ];
    return [
      quarterWorkbookSheet(),
      {name:`ملخص ${monthLabel(selectedMonth)}`,rows:summaryRows,widths:[9,31,12,13,12,9,10,9,17,10,13,11,15,16,15,11,15,16],freezeRows:7,freezeCols:2,merges:["A1:R1","A2:R2"],autoFilter:`A7:R${summaryRows.length}`,rowHeights:{1:29,2:23,7:34}},
      {name:"السجل",rows:logRows,widths:[13,11,31,13,13,13,17,15,13,13,28,15,15,24,13],freezeRows:4,freezeCols:3,merges:["A1:O1","A2:O2"],autoFilter:`A4:O${logRows.length}`,rowHeights:{1:29,2:23,4:34}},
      {name:"القواعد والإعدادات",rows:settingsRows,widths:[15,29,18,58],freezeRows:4,merges:["A1:D1","A2:D2"],autoFilter:`A4:D${settingsRows.length}`,rowHeights:{1:29,2:23,4:32}},
      {name:"المستشفيات",rows:hospitalsRows,widths:[10,34,25,20,14],freezeRows:4,merges:["A1:E1","A2:E2"],autoFilter:`A4:E${hospitalsRows.length}`,rowHeights:{1:29,2:23,4:32}},
    ];
  }
  function quarterWorkbookSheet(){
    if(!X)throw new Error("مكوّن Excel غير محمّل");
    const ST=X.STYLE;
    const summary=quarterlySummary();
    const scope=summary.hospitalId==="all"?"جميع المستشفيات المحتسبة":summary.hospitals[0]?.hospital.name||"لا توجد مستشفيات";
    const metric=(value)=>summary.due?percentCell(value):cell("—",ST.muted);
    const rows=[
      [cell("ملخص ثلاثة أشهر — متابعة الحالات الحرجة والوفاة الدماغية",ST.title)],
      [cell(`${monthLabel(summary.startMonth)} — ${monthLabel(summary.months.at(-1))} · ${scope} · أُنشئ ${formatDate(R.isoDate())} ${nowTime()}`,ST.section)],
      [],
      ["نسبة الاستجابة","الإرسال في الوقت","اكتمال التحديث","المؤشر العام","بلاغات جديدة","خروج/وفاة/تبرع","وفاة دماغية"].map((value)=>cell(value,ST.header)),
      [metric(summary.response),metric(summary.punctuality),summary.completion===null?cell("—",ST.muted):percentCell(summary.completion),metric(summary.score),summary.newCases,summary.exits,summary.brainDeath],
      [],
      [cell("المقارنة الشهرية",ST.section)],
      ["الشهر","مستحق","أرسل","الاستجابة","في الوقت","الالتزام بالوقت","المحدث","المطلوب","اكتمال التحديث","المؤشر","بلاغات جديدة","خروج/وفاة/تبرع","وفاة دماغية"].map((value)=>cell(value,ST.header)),
      ...summary.monthly.map((item)=>[monthLabel(item.month),item.due,item.sent,item.due?percentCell(item.response):cell("—",ST.muted),item.ontime,item.due?percentCell(item.punctuality):cell("—",ST.muted),item.updated,item.required,item.completion===null?cell("—",ST.muted):percentCell(item.completion),item.due?percentCell(item.score):cell("—",ST.muted),item.newCases,item.exits,item.brainDeath]),
      [],
      [cell("ملخص المستشفيات خلال الفترة",ST.section)],
      ["الترتيب","المستشفى","عبء الحالات","مستحق","أرسل","الاستجابة","في الوقت","الالتزام بالوقت","المحدث","المطلوب","اكتمال التحديث","بلاغات جديدة","خروج/وفاة/تبرع","وفاة دماغية","المؤشر","نقاط الترتيب"].map((value)=>cell(value,ST.header)),
      ...summary.hospitals.map((item)=>[item.rank,item.hospital.name,item.load,item.due,item.sent,item.due?percentCell(item.response):cell("—",ST.muted),item.ontime,item.due?percentCell(item.punctuality):cell("—",ST.muted),item.updated,item.required,item.completion===null?cell("—",ST.muted):percentCell(item.completion),item.newCases,item.exits,item.brainDeath,item.due?percentCell(item.score):cell("—",ST.muted),item.due?item.rankingPoints:""]),
    ];
    if(!summary.hospitals.length)rows.push([cell("لا توجد مستشفيات محتسبة.",ST.muted)]);
    return {name:"ملخص 3 أشهر",rows,widths:[11,34,13,11,11,15,12,18,12,12,16,14,18,15,13,15],freezeRows:8,freezeCols:2,merges:["A1:P1","A2:P2","A7:P7","A13:P13"],rowHeights:{1:29,2:23,4:32,8:34,14:34}};
  }
  async function createExcelFile(){
    const bytes=await X.createWorkbook(workbookSheets(),{title:"متابعة الحالات الحرجة والوفاة الدماغية",creator:"تجمع القصيم الصحي"});
    return {blob:X.workbookBlob(bytes),name:`متابعة_تحديثات_الحالات_${R.isoDate()}.xlsx`};
  }
  async function exportExcel(options={}){
    try{
      if(!options.silent)toast("جارٍ إنشاء تقرير Excel…");
      const file=await createExcelFile();
      download(file.name,file.blob,X.MIME);
      if(!options.silent)toast("تم تنزيل تقرير Excel بكل البيانات والنِسَب");
      return file;
    }catch(error){toast(`تعذّر إنشاء ملف Excel: ${error.message}`,"danger");return null;}
  }
  async function exportQuarterExcel(){
    try{
      toast("جارٍ إنشاء ملخص الأشهر الثلاثة…");
      const bytes=await X.createWorkbook([quarterWorkbookSheet()],{title:"ملخص ثلاثة أشهر",creator:"تجمع القصيم الصحي"});
      const summary=quarterlySummary();
      download(`ملخص_ثلاثة_أشهر_${summary.startMonth}_إلى_${summary.months.at(-1)}.xlsx`,X.workbookBlob(bytes),X.MIME);
      toast("تم تنزيل ملخص الأشهر الثلاثة");
    }catch(error){toast(`تعذّر إنشاء الملخص: ${error.message}`,"danger");}
  }
  async function openGoogleSheets(){
    const approved=confirm("سيتم تنزيل تقرير Excel المحسوب على جهازك وفتح Google Sheets في علامة جديدة. بعد فتح الورقة اختر: ملف ← استيراد ← تحميل، ثم اختر الملف المنزّل. ستغادر البيانات جهازك فقط عندما تختار رفع الملف إلى Google.\n\nمتابعة؟");
    if(!approved)return;
    window.open("https://sheets.new","_blank","noopener,noreferrer");
    const file=await exportExcel({silent:true});
    if(file)toast("تم تنزيل الملف وفتح Google Sheets — استورده من قائمة «ملف»");
  }
  function parseCsv(text){const rows=[];let row=[],cell="",quote=false;for(let i=0;i<text.length;i++){const c=text[i];if(quote){if(c==='"'&&text[i+1]==='"'){cell+='"';i++;}else if(c==='"')quote=false;else cell+=c;}else if(c==='"')quote=true;else if(c===','){row.push(cell);cell="";}else if(c==='\n'){row.push(cell.replace(/\r$/,""));rows.push(row);row=[];cell="";}else cell+=c;}row.push(cell.replace(/\r$/,""));if(row.some(Boolean))rows.push(row);return rows;}
  async function importBackupFile(e){const file=e.target.files[0];if(!file)return;try{data=S.importBackup(await file.text());selectedDate=data.lastDate||R.isoDate();selectedMonth=selectedDate.slice(0,7);toast("تمت استعادة النسخة");render();}catch(err){toast(err.message,"danger");}}
  async function importCsvFile(e){const file=e.target.files[0];if(!file)return;try{const rows=parseCsv((await file.text()).replace(/^\ufeff/,""));const head=rows.shift();const idx=Object.fromEntries(head.map((x,i)=>[x,i]));let count=0;rows.forEach(row=>{const date=row[idx["التاريخ"]];const name=row[idx["المستشفى"]];const h=data.hospitals.find(x=>x.name===name);if(!date||!h)return;const adjustment=row[idx["تعديل الرصيد"]];S.saveRecord(data,date,h.id,{balanceAdjustment:adjustment===""?"":n(adjustment),newCases:n(row[idx["بلاغات جديدة"]]),exits:n(row[idx["خروج/وفاة/تبرع"]]),updated:n(row[idx["الحالات المحدثة"]]),receivedAt:row[idx["وقت الاستلام"]]||"",brainDeath:n(row[idx["وفاة دماغية"]]),notes:row[idx["ملاحظات"]]||""});count++;});toast(`تم استيراد ${count} صف`);render();}catch(err){toast("تعذر قراءة ملف CSV","danger");}}
  function loadDemo(){const dates=dateRangeForMonth(selectedMonth).slice(0,10);activeHospitals().forEach((h,hi)=>{dates.forEach((date,di)=>{const prior=di===0&&hi===0?4:undefined;const mode=(hi+di)%6;const patch={receivedAt:mode===4?"11:15":"09:10",newCases:(hi===0&&di%4===0)?1:0,exits:(hi===0&&di===5)?1:0,updated:0,brainDeath:(hi===0&&di===6)?1:0,notes:""};if(prior!==undefined)patch.balanceAdjustment=prior;const temp=R.calculateRecord({...patch,carried:S.previousClosing(data,date,h.id)},data.settings);patch.updated=mode===2?Math.max(0,temp.required-1):temp.required;if(mode===5)patch.receivedAt="12:20";S.saveRecord(data,date,h.id,patch);});});}

  function registerWebMcp() {
    const context = document.modelContext;
    if (!context?.registerTool) return;
    const dateSchema = { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" };
    void Promise.resolve(context.registerTool({
      name: "read_daily_hospital_status",
      title: "قراءة حالة المستشفيات اليومية",
      description: "يعيد حالة ودرجة ورصيد جميع المستشفيات المحتسبة في تاريخ محدد دون تعديل البيانات.",
      inputSchema: { type: "object", properties: { date: dateSchema }, additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      execute(input) { const date = input?.date || selectedDate; return { date, hospitals: dayRows(date).map(({h,r,status}) => ({ id:h.id, name:h.name, required:r.required, effectiveUpdated:r.effectiveUpdated, closing:r.closing, status, score:Number(r.score.toFixed(1)) })) }; },
    })).catch(() => {});
    void Promise.resolve(context.registerTool({
      name: "save_daily_hospital_update",
      title: "حفظ تحديث مستشفى",
      description: "يحفظ تحديث مستشفى في تاريخ محدد ويعيد النتيجة المحسوبة بنفس قواعد شاشة الإدخال.",
      inputSchema: { type: "object", properties: { date: dateSchema, hospitalId:{type:"string"}, balanceAdjustment:{type:"integer",minimum:0}, newCases:{type:"integer",minimum:0}, exits:{type:"integer",minimum:0}, updated:{type:"integer",minimum:0}, receivedAt:{type:"string",pattern:"^([01]\\d|2[0-3]):[0-5]\\d$"}, brainDeath:{type:"integer",minimum:0}, notes:{type:"string",maxLength:500} }, required:["date","hospitalId","receivedAt"], additionalProperties:false },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute(input) { if(!activeHospitals().some(h=>h.id===input.hospitalId)) throw new Error("المستشفى غير موجود أو غير محتسب"); const fields={};["balanceAdjustment","newCases","exits","updated","receivedAt","brainDeath","notes"].forEach(k=>{if(input[k]!==undefined)fields[k]=input[k];});S.saveRecord(data,input.date,input.hospitalId,fields);selectedDate=input.date;selectedMonth=input.date.slice(0,7);view="entry";render();const r=calc(input.date,input.hospitalId);return {saved:true,date:input.date,hospitalId:input.hospitalId,required:r.required,effectiveUpdated:r.effectiveUpdated,closing:r.closing,status:resolvedStatus(input.date,r),score:Number(r.score.toFixed(1)),errors:r.errors};},
    })).catch(() => {});
  }

  document.querySelectorAll("[data-nav]").forEach(el=>el.addEventListener("click",e=>{e.preventDefault();if(!accessGranted)return;view=el.dataset.nav;render();document.body.classList.remove("menu-open");}));
  document.getElementById("menuToggle").addEventListener("click",()=>document.body.classList.toggle("menu-open"));
  document.querySelectorAll("[data-theme]").forEach(el=>el.addEventListener("click",()=>{document.documentElement.dataset.theme=el.dataset.theme;localStorage.setItem("qassim-theme",el.dataset.theme);}));
  window.addEventListener("hct-storage-status",(event)=>{
    updateStorageStatus(event.detail);
    if(event.detail.status==="auth-required"){accessGranted=false;data=S.blankDefaults();renderLogin(event.detail.message);return;}
    if(event.detail.status==="conflict"&&accessGranted)renderConflict(event.detail.message);
  });
  window.addEventListener("online",()=>{if(accessGranted&&S.status().mode==="offline")start();});
  document.getElementById("logoutButton").addEventListener("click",async()=>{
    if(!confirm("تسجيل الخروج من النسخة السحابية؟"))return;
    try {
      await S.flush();
      const state=S.status();
      if(state.pending||state.mode==="offline"||state.mode==="conflict"){
        toast("لا يمكن تسجيل الخروج قبل مزامنة التغييرات. نزّل نسخة احتياطية إذا استمر التعذر.","danger");
        return;
      }
      accessGranted=false;
      data=S.blankDefaults();
      document.body.classList.add("auth-locked");
      await S.logout();
      renderLogin();
    } catch (error) {
      accessGranted=true;
      document.body.classList.remove("auth-locked");
      toast(error.message||"تعذر تسجيل الخروج.","danger");
    }
  });
  document.documentElement.dataset.theme=localStorage.getItem("qassim-theme")||"light";
  start();
})();
