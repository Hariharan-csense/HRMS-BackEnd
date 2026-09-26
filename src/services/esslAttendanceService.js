const db = require("../db/db");
const { fail, tenant, id, normalizePunch, rawEnvelope, safeError } = require("../utils/esslUtils");

// Dependency injection keeps the framework testable without a physical device.
// Production always calls the existing attendance engine.
const createImporter = (database = db, attendanceService = null) => {
  const ingestPunch = async ({ companyId, deviceId, batchId, punch }) => {
    tenant(companyId); id(deviceId);
    const scope = { company_id: companyId, device_id: deviceId };
    const device = await database("essl_devices").where({ company_id: companyId, id: deviceId }).first();
    if (!device) fail(404, "Device not found");
    if (!device.is_active) fail(409, "Device is disabled");
    let normalized, validationError;
    try { normalized = normalizePunch(punch); } catch (error) { validationError = safeError(error); }
    const raw = { ...scope, ...(normalized || {}), sync_batch_id: batchId, raw_payload: rawEnvelope(punch), processing_error: validationError || null };
    let logId, duplicate = false;
    try { [logId] = await database("essl_attendance_logs").insert(raw); }
    catch (error) {
      if (error.code !== "ER_DUP_ENTRY" || !normalized) throw error;
      duplicate = true;
      const existing = await database("essl_attendance_logs").where({ ...scope, dedup_key: normalized.dedup_key }).first();
      if (!existing) throw error;
      logId = existing.id;
      if (existing.essl_user_id !== normalized.essl_user_id || existing.punch_type !== normalized.punch_type || new Date(existing.punch_time).getTime() !== normalized.punch_time.getTime()) {
        return { inserted: 0, duplicate: 1, processed: 0, failed: 1, error: "External log ID was reused with different punch data" };
      }
    }
    const counts = { inserted: duplicate ? 0 : 1, duplicate: duplicate ? 1 : 0, processed: 0, failed: 0 };
    if (validationError) return { ...counts, failed: 1, error: validationError };
    try {
      const processed = await database.transaction(async (trx) => {
        const mapping = await trx("essl_employee_mappings").where({ ...scope, essl_user_id: normalized.essl_user_id, is_active: true }).first();
        if (!mapping) fail(422, "No active employee mapping for this device user");
        // Serialize all device punches for this employee, including across devices.
        const employee = await trx("employees").where({ company_id: companyId, id: mapping.employee_id }).forUpdate().first("id");
        if (!employee) fail(422, "Mapped employee no longer exists in this company");
        const log = await trx("essl_attendance_logs").where({ ...scope, id: logId }).forUpdate().first();
        if (log.processed) return false;
        const currentDevice = await trx("essl_devices").where({ company_id: companyId, id: deviceId }).first();
        if (!currentDevice?.is_active) fail(409, "Device is disabled");
        // Historical backfill cannot safely be replayed into an already newer session.
        const newer = await trx("attendance").where({ company_id: companyId, employee_id: employee.id }).andWhere(function () {
          this.where("check_in", ">", normalized.punch_time).orWhere("check_out", ">", normalized.punch_time);
        }).first("id");
        if (newer) fail(409, "Punch precedes existing attendance; review through attendance override");
        const engine = attendanceService || require("./attendance.service");
        const args = { employeeId: employee.id, companyId, punchTime: normalized.punch_time, deviceInfo: "ESSL:" + deviceId, db: trx };
        if (normalized.punch_type === "IN") await engine.doCheckIn(args);
        else await engine.doCheckOut(args);
        await trx("essl_attendance_logs").where({ ...scope, id: logId }).update({
          employee_id: employee.id, processed: true, processed_at: trx.fn.now(),
          processing_error: null, updated_at: trx.fn.now(),
        });
        return true;
      });
      return { ...counts, processed: processed ? 1 : 0 };
    } catch (error) {
      const message = safeError(error);
      await database("essl_attendance_logs").where({ ...scope, id: logId, processed: false }).update({ processing_error: message, updated_at: database.fn.now() });
      return { ...counts, failed: 1, error: message };
    }
  };
  return { ingestPunch };
};
module.exports = { ...createImporter(), createImporter };

