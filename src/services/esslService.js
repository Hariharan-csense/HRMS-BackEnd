const db = require("../db/db");
const config = require("../config/esslConfig");
const { NOT_CONFIGURED, fail, id, tenant, text, bool, deviceInput, page, punchDate } = require("../utils/esslUtils");
const deviceFields = ["id", "company_id", "device_name", "device_model", "device_serial_number", "device_ip", "device_port", "connection_type", "integration_type", "api_url", "is_active", "last_sync_at", "last_sync_status", "last_sync_error", "created_at", "updated_at"];
const getDevice = async (companyId, deviceId, database = db) => {
  const row = await database("essl_devices").where({ company_id: tenant(companyId), id: id(deviceId) }).select(deviceFields).first();
  if (!row) fail(404, "Device not found");
  return row;
};
const listDevices = (companyId) => db("essl_devices").where({ company_id: tenant(companyId) }).select(deviceFields).orderBy("id", "desc");
const createDevice = async (companyId, input) => {
  const [deviceId] = await db("essl_devices").insert({ ...deviceInput(input, true), company_id: tenant(companyId) });
  return getDevice(companyId, deviceId);
};
const updateDevice = async (companyId, deviceId, input) => {
  await getDevice(companyId, deviceId);
  const values = deviceInput(input);
  await db("essl_devices").where({ company_id: tenant(companyId), id: id(deviceId) }).update({ ...values, updated_at: db.fn.now() });
  return getDevice(companyId, deviceId);
};
const disableDevice = (companyId, deviceId) => updateDevice(companyId, deviceId, { is_active: false });
const requireReady = (device) => {
  if (!device.is_active) fail(409, "Device is disabled");
  if (!config().enabled) fail(503, "eSSL is disabled. " + NOT_CONFIGURED);
};
const connectToDevice = async (device) => { requireReady(device); fail(501, NOT_CONFIGURED); };
const fetchAttendanceLogs = async (device) => { await connectToDevice(device); fail(501, NOT_CONFIGURED); };
const testConnection = async (companyId, deviceId) => connectToDevice(await getDevice(companyId, deviceId));
const getStatus = async (companyId, deviceId) => ({
  device: await getDevice(companyId, deviceId),
  enabled: config().enabled, communication_configured: false, message: NOT_CONFIGURED,
});
const mappingQuery = (companyId) => db("essl_employee_mappings as m")
  .join("essl_devices as d", function () { this.on("d.id", "m.device_id").andOn("d.company_id", "m.company_id"); })
  .join("employees as e", function () { this.on("e.id", "m.employee_id").andOn("e.company_id", "m.company_id"); })
  .where("m.company_id", tenant(companyId))
  .select("m.*", "d.device_name", "e.first_name", "e.last_name", "e.employee_id as employee_code");
const listMappings = (companyId) => mappingQuery(companyId).orderBy("m.id", "desc");
const saveMapping = async (companyId, mappingId, input) => {
  tenant(companyId);
  if (!input || typeof input !== "object" || Array.isArray(input)) fail(400, "Invalid employee mapping");
  if (Object.keys(input).some((key) => !["device_id", "employee_id", "essl_user_id", "is_active"].includes(key))) fail(400, "Unsupported mapping field");
  return db.transaction(async (trx) => {
    let existing;
    if (mappingId) {
      existing = await trx("essl_employee_mappings").where({ company_id: companyId, id: id(mappingId) }).forUpdate().first();
      if (!existing) fail(404, "Mapping not found");
    }
    const values = {
      device_id: id(input.device_id ?? existing?.device_id, "Device ID"),
      employee_id: id(input.employee_id ?? existing?.employee_id, "Employee ID"),
      essl_user_id: text(input.essl_user_id ?? existing?.essl_user_id, "eSSL user ID", 191, true),
      is_active: "is_active" in input ? bool(input.is_active) : Boolean(existing?.is_active ?? true),
    };
    const device = await getDevice(companyId, values.device_id, trx);
    if (values.is_active && !device.is_active) fail(409, "Device is disabled");
    if (!await trx("employees").where({ company_id: companyId, id: values.employee_id }).first("id")) fail(404, "Employee not found");
    if (existing) await trx("essl_employee_mappings").where({ company_id: companyId, id: existing.id }).update({ ...values, updated_at: trx.fn.now() });
    else [mappingId] = await trx("essl_employee_mappings").insert({ ...values, company_id: companyId });
    return trx("essl_employee_mappings").where({ company_id: companyId, id: mappingId }).first();
  });
};
const disableMapping = (companyId, mappingId) => saveMapping(companyId, mappingId, { is_active: false });
const employees = (companyId, query = {}) => {
  const sql = db("employees").where({ company_id: tenant(companyId) }).select("id", "employee_id", "first_name", "last_name").orderBy("first_name").limit(100);
  const search = text(query.search, "Employee search", 100);
  if (search) sql.andWhere(function () { this.where("first_name", "like", "%" + search + "%").orWhere("last_name", "like", "%" + search + "%").orWhere("employee_id", "like", "%" + search + "%"); });
  return sql;
};
const listLogs = async (companyId, query = {}, deviceId) => {
  if (deviceId) await getDevice(companyId, deviceId);
  const sql = db("essl_attendance_logs as l")
    .join("essl_devices as d", function () { this.on("d.id", "l.device_id").andOn("d.company_id", "l.company_id"); })
    .leftJoin("employees as e", function () { this.on("e.id", "l.employee_id").andOn("e.company_id", "l.company_id"); })
    .where("l.company_id", tenant(companyId))
    .select("l.id", "l.device_id", "l.employee_id", "l.essl_user_id", "l.punch_time", "l.punch_type", "l.external_log_id", "l.sync_batch_id", "l.processed", "l.processed_at", "l.processing_error", "l.created_at", "d.device_name", "e.first_name", "e.last_name", "e.employee_id as employee_code");
  if (deviceId || query.device_id) sql.andWhere("l.device_id", id(deviceId || query.device_id));
  if (query.employee_id) sql.andWhere("l.employee_id", id(query.employee_id));
  if (query.from) sql.andWhere("l.punch_time", ">=", punchDate(query.from));
  if (query.to) sql.andWhere("l.punch_time", "<=", punchDate(query.to));
  if (query.processed !== undefined && query.processed !== "") {
    if (!["true", "false"].includes(query.processed)) fail(400, "Invalid processing status");
    sql.andWhere("l.processed", query.processed === "true");
  }
  const { limit, offset } = page(query);
  return sql.orderBy("l.id", "desc").limit(limit).offset(offset);
};
const listSyncLogs = (companyId, query = {}) => {
  const sql = db("essl_sync_logs").where({ company_id: tenant(companyId) });
  if (query.device_id) sql.andWhere("device_id", id(query.device_id));
  const { limit, offset } = page(query);
  return sql.orderBy("id", "desc").limit(limit).offset(offset);
};
module.exports = { getDevice, listDevices, createDevice, updateDevice, disableDevice, getStatus, testConnection, connectToDevice, fetchAttendanceLogs, listMappings, saveMapping, disableMapping, employees, listLogs, listSyncLogs };

