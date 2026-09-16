"use strict";

const { HttpError } = require("./http.js");

let cachedDatabaseUrl;
let cachedSql;

function requiredDatabaseUrl() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new HttpError(500, "server_misconfigured", "إعداد DATABASE_URL مفقود.");
  }
  let parsed;
  try {
    parsed = new URL(databaseUrl);
  } catch (_) {
    throw new HttpError(500, "server_misconfigured", "إعداد DATABASE_URL غير صالح.");
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new HttpError(500, "server_misconfigured", "يجب أن يكون DATABASE_URL رابط PostgreSQL.");
  }
  return databaseUrl;
}

function getSql() {
  const databaseUrl = requiredDatabaseUrl();
  if (cachedSql && cachedDatabaseUrl === databaseUrl) return cachedSql;

  let neon;
  try {
    const driver = require("@neondatabase/serverless");
    neon = driver.neon || driver.default?.neon;
  } catch (_) {
    throw new HttpError(500, "server_misconfigured", "حزمة الاتصال بقاعدة Neon غير مثبتة.");
  }
  if (typeof neon !== "function") {
    throw new HttpError(500, "server_misconfigured", "تعذّر تحميل موصل قاعدة Neon.");
  }

  cachedDatabaseUrl = databaseUrl;
  cachedSql = neon(databaseUrl);
  return cachedSql;
}

function databaseError(error) {
  if (error instanceof HttpError) return error;
  if (error?.code === "42P01") {
    return new HttpError(503, "database_not_initialized", "قاعدة البيانات غير مهيأة. شغّل ملف db/schema.sql أولًا.");
  }
  if (error?.code === "42501") {
    return new HttpError(503, "database_permission_denied", "حساب قاعدة البيانات لا يملك الصلاحيات المطلوبة.");
  }
  return new HttpError(503, "database_unavailable", "تعذّر الاتصال بقاعدة البيانات حاليًا.");
}

function normalizeRevision(value) {
  const revision = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new HttpError(500, "invalid_database_state", "رقم المراجعة المخزن في قاعدة البيانات غير صالح.");
  }
  return revision;
}

function normalizeUpdatedAt(value) {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" && !Number.isNaN(Date.parse(value))) return new Date(value).toISOString();
  throw new HttpError(500, "invalid_database_state", "وقت التحديث المخزن في قاعدة البيانات غير صالح.");
}

function normalizeData(value) {
  if (value === null) return null;
  let data = value;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch (_) {
      throw new HttpError(500, "invalid_database_state", "بيانات الحالة المخزنة غير صالحة.");
    }
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new HttpError(500, "invalid_database_state", "بيانات الحالة المخزنة غير صالحة.");
  }
  return data;
}

function normalizeStateRow(row) {
  if (!row) {
    throw new HttpError(503, "database_not_initialized", "صف الحالة غير موجود. شغّل ملف db/schema.sql أولًا.");
  }
  return {
    data: normalizeData(row.data),
    revision: normalizeRevision(row.revision),
    updatedAt: normalizeUpdatedAt(row.updatedAt ?? row.updated_at),
  };
}

function normalizeStateMetadata(row) {
  if (!row) {
    throw new HttpError(500, "invalid_database_state", "لم تُرجع قاعدة البيانات نتيجة الحفظ.");
  }
  return {
    revision: normalizeRevision(row.revision),
    updatedAt: normalizeUpdatedAt(row.updatedAt ?? row.updated_at),
  };
}

async function getState() {
  try {
    const sql = getSql();
    const rows = await sql`
      SELECT data, revision, updated_at AS "updatedAt"
      FROM app_state
      WHERE id = 1
    `;
    return normalizeStateRow(rows[0]);
  } catch (error) {
    throw databaseError(error);
  }
}

async function updateState(data, expectedRevision) {
  try {
    const sql = getSql();
    const serialized = JSON.stringify(data);
    const rows = await sql`
      WITH archived AS (
        INSERT INTO app_state_revisions (revision, data, previous_updated_at, action)
        SELECT revision, data, updated_at, 'state_update'
        FROM app_state
        WHERE id = 1 AND revision = ${expectedRevision}
        ON CONFLICT (revision) DO NOTHING
        RETURNING revision
      )
      UPDATE app_state
      SET data = CAST(${serialized} AS jsonb),
          revision = app_state.revision + 1,
          updated_at = NOW()
      WHERE id = 1
        AND app_state.revision = ${expectedRevision}
        AND EXISTS (SELECT 1 FROM archived)
      RETURNING revision, updated_at AS "updatedAt"
    `;
    if (rows.length) return { updated: true, state: normalizeStateMetadata(rows[0]) };
    return { updated: false, state: await getState() };
  } catch (error) {
    throw databaseError(error);
  }
}

function resetDatabaseClientForTests() {
  cachedDatabaseUrl = undefined;
  cachedSql = undefined;
}

module.exports = {
  databaseError,
  getState,
  getSql,
  normalizeStateMetadata,
  normalizeStateRow,
  resetDatabaseClientForTests,
  updateState,
};
