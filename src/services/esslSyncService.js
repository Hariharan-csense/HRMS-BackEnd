const crypto = require("crypto");
const db = require("../db/db");
const devices = require("./esslService");
const attendance = require("./esslAttendanceService");
const config = require("../config/esslConfig");
const { fail, tenant, id, safeError } = require("../utils/esslUtils");

const processBatch = async (records, context, ingest = attendance.ingestPunch) => {
  if (!Array.isArray(records) || records.length > 10000) fail(502, "Unexpected device response; expected at most 10000 normalized punches per batch");
  const summary = { fetched_count: records.length, inserted_count: 0, duplicate_count: 0, processed_count: 0, failed_count: 0 };
  // Explicit timestamps are sorted before replay; invalid rows remain auditable.
  const ordered = [...records].sort((a, b) => (Date.parse(a?.punch_time) || 0) - (Date.parse(b?.punch_time) || 0));
  for (const punch of ordered) {
    try {
      const result = await ingest({ ...context, punch });
      summary.inserted_count += result.inserted;
      summary.duplicate_count += result.duplicate;
      summary.processed_count += result.processed;
      summary.failed_count += result.failed;
    } catch {
      // Do not expose database/adapter messages (they can contain credentials).
      summary.failed_count++;
    }
  }
  return summary;
};
const syncDevice = async (companyId, deviceId) => {
  tenant(companyId); deviceId = id(deviceId);
  await devices.getDevice(companyId, deviceId);
  // MySQL advisory locks span processes and release on connection loss.
  const connection = await db.client.acquireConnection();
  const lockName = "essl:" + companyId + ":" + deviceId;
  let locked = false, batchId;
  try {
    const [rows] = await db.raw("SELECT GET_LOCK(?, 0) AS acquired", [lockName]).connection(connection);
    locked = Number(rows[0].acquired) === 1;
    if (!locked) fail(409, "A synchronization is already running for this device");
    const device = await devices.getDevice(companyId, deviceId);
    batchId = crypto.randomUUID();
    // A RUNNING record with no lock belongs to an interrupted process.
    await db("essl_sync_logs").where({ company_id: companyId, device_id: deviceId, status: "RUNNING" }).update({
      status: "FAILED", completed_at: db.fn.now(), error_message: "Synchronization interrupted; retry is safe",
    });
    await db("essl_sync_logs").insert({ company_id: companyId, device_id: deviceId, sync_batch_id: batchId, started_at: db.fn.now(), status: "RUNNING" });
    try {
      const records = await devices.fetchAttendanceLogs(device, { timeout: config().connectionTimeout });
      const summary = await processBatch(records, { companyId, deviceId, batchId });
      const status = summary.failed_count ? (summary.failed_count === summary.fetched_count ? "FAILED" : "PARTIAL") : "SUCCESS";
      const errorMessage = summary.failed_count ? "Some punches failed; review raw biometric logs" : null;
      await db.transaction(async (trx) => {
        await trx("essl_sync_logs").where({ company_id: companyId, sync_batch_id: batchId }).update({ ...summary, status, completed_at: trx.fn.now(), error_message: errorMessage });
        await trx("essl_devices").where({ company_id: companyId, id: deviceId }).update({
          last_sync_at: trx.fn.now(), last_sync_status: status, last_sync_error: errorMessage, updated_at: trx.fn.now(),
        });
      });
      return { deviceId, sync_batch_id: batchId, status, ...summary };
    } catch (error) {
      const message = safeError(error);
      await db.transaction(async (trx) => {
        await trx("essl_sync_logs").where({ company_id: companyId, sync_batch_id: batchId }).update({ status: "FAILED", completed_at: trx.fn.now(), error_message: message });
        await trx("essl_devices").where({ company_id: companyId, id: deviceId }).update({
          last_sync_at: trx.fn.now(), last_sync_status: "FAILED", last_sync_error: message, updated_at: trx.fn.now(),
        });
      });
      throw error;
    }
  } finally {
    try { if (locked) await db.raw("SELECT RELEASE_LOCK(?)", [lockName]).connection(connection); }
    finally { await db.client.releaseConnection(connection); }
  }
};
// Matches server.js's existing unref'd interval pattern; no new scheduler package.
const startScheduledSync = async () => {
  const settings = config();
  if (!settings.enabled || !settings.syncEnabled) return null;
  const requiredTables = [
    "essl_devices",
    "essl_employee_mappings",
    "essl_attendance_logs",
    "essl_sync_logs",
  ];
  const tableChecks = await Promise.all(
    requiredTables.map(async (table) => [table, await db.schema.hasTable(table)]),
  );
  const missingTables = tableChecks
    .filter(([, exists]) => !exists)
    .map(([table]) => table);
  if (missingTables.length) {
    console.error(
      `eSSL scheduler disabled: database migration is pending (${missingTables.join(", ")}).`,
    );
    return null;
  }
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      // System job enumerates tenant IDs, then every sync executes inside that tenant.
      const companies = await db("companies").select("id");
      for (const company of companies) {
        const rows = await db("essl_devices").where({ company_id: company.id, is_active: true }).select("id");
        for (const device of rows) {
          try { await syncDevice(company.id, device.id); }
          catch (error) { console.error("eSSL scheduled sync:", safeError(error)); }
        }
      }
    } catch (error) { console.error("eSSL scheduler:", safeError(error)); }
    finally { running = false; }
  };
  const timer = setInterval(tick, settings.intervalMs);
  timer.unref();
  console.log(
    `eSSL scheduler enabled; interval ${settings.intervalMs / 60000} minute(s).`,
  );
  return timer;
};
module.exports = { processBatch, syncDevice, startScheduledSync };
