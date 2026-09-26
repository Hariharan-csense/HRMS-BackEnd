const crypto = require("crypto");
const { isIP } = require("node:net");
const NOT_CONFIGURED = "eSSL device integration method is not configured. Device model/API/SDK details are required.";
const fail = (status, message) => { const error = new Error(message); error.status = status; error.esslSafe = true; throw error; };
const id = (value, label = "ID") => {
  if (!/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(Number(value))) fail(400, label + " must be a positive integer");
  return Number(value);
};
const tenant = (value) => id(value, "Authenticated company ID");
const text = (value, label, max = 191, required = false) => {
  if (value == null || value === "") { if (required) fail(400, label + " is required"); return null; }
  if (typeof value !== "string" || !value.trim() || value.length > max) fail(400, "Invalid " + label);
  return value.trim();
};
const bool = (value) => {
  if (typeof value !== "boolean") fail(400, "is_active must be a boolean");
  return value;
};
const deviceInput = (input, creating = false) => {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail(400, "Invalid device configuration");
  const result = {};
  const fields = ["device_name", "device_model", "device_serial_number", "device_ip", "connection_type", "integration_type", "api_url"];
  // No credential contract exists yet. Do not silently store or discard secrets.
  for (const key of Object.keys(input)) {
    if (!fields.includes(key) && !["device_port", "is_active"].includes(key)) fail(400, "Unsupported device configuration field");
  }
  for (const key of fields) {
    if (key in input || (creating && key === "device_name")) result[key] = text(input[key], key, key === "api_url" ? 2048 : 191, key === "device_name");
  }
  if (result.device_ip && !isIP(result.device_ip)) fail(400, "Invalid device IP address");
  if ("device_port" in input) {
    result.device_port = input.device_port === null || input.device_port === "" ? null : id(input.device_port, "Device port");
    if (result.device_port > 65535) fail(400, "Device port must be between 1 and 65535");
  }
  if (result.connection_type && !["LAN", "WAN", "CLOUD", "UNKNOWN"].includes(result.connection_type)) fail(400, "Invalid connection type");
  if (result.api_url) {
    let url;
    try { url = new URL(result.api_url); } catch { fail(400, "Invalid API URL"); }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) fail(400, "API URL must be HTTP(S) without credentials, query parameters or fragments");
  }
  if ("is_active" in input) result.is_active = bool(input.is_active);
  return result;
};
// Adapter contract: explicit offset/UTC, explicit direction and stable external ID.
// Local device wall-clock strings and undocumented numeric direction codes are rejected.
const punchDate = (value) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) fail(400, "Punch timestamp requires an explicit timezone offset");
  const date = new Date(value);
  const day = value.slice(0, 10);
  const calendar = new Date(day + "T00:00:00Z");
  if (!Number.isFinite(date.getTime()) || !Number.isFinite(calendar.getTime()) || calendar.toISOString().slice(0, 10) !== day || Number(value.slice(11, 13)) > 23 || Number(value.slice(14, 16)) > 59 || Number(value.slice(17, 19)) > 59) fail(400, "Invalid punch timestamp");
  return date;
};
const normalizePunch = (input) => {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail(400, "Invalid punch record");
  const external = text(input.external_log_id, "external_log_id", 191, true);
  const user = text(input.essl_user_id, "essl_user_id", 191, true);
  if (!["IN", "OUT"].includes(input.punch_type)) fail(400, "Punch direction must be IN or OUT");
  const time = punchDate(input.punch_time);
  return { external_log_id: external, essl_user_id: user, punch_type: input.punch_type, punch_time: time,
    dedup_key: crypto.createHash("sha256").update(external).digest("hex") };
};
// Store only the normalized adapter envelope; vendor payloads must be redacted by
// a reviewed adapter before additional fields can be persisted.
const rawEnvelope = (input) => JSON.stringify(Object.fromEntries(
  ["external_log_id", "essl_user_id", "punch_type", "punch_time"].map((key) => [key,
    typeof input?.[key] === "string" ? input[key].slice(0, 256) : null])
));
const safeError = (error) => {
  if (error?.esslSafe) return error.message;
  if (error?.code === "ER_DUP_ENTRY") return "A device or employee mapping with these identifiers already exists";
  const known = ["Already checked in", "No active check-in", "Employee not found", "Invalid punch time"];
  if (known.includes(error?.message)) return error.message;
  return "eSSL operation failed. Check server configuration and retry.";
};
const page = (query = {}) => ({
  limit: Math.min(100, id(query.limit || 50, "Limit")),
  offset: (id(query.page || 1, "Page") - 1) * Math.min(100, id(query.limit || 50, "Limit")),
});
module.exports = { NOT_CONFIGURED, fail, id, tenant, text, bool, deviceInput, punchDate, normalizePunch, rawEnvelope, safeError, page };

