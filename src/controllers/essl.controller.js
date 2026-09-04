const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const knex = require("../db/db");
const { doCheckIn, doCheckOut } = require("../services/attendance.service");

const normalizePunchTime = (value) => {
  if (!value) return new Date();

  const parsedDate = new Date(value);
  if (Number.isNaN(parsedDate.getTime())) {
    return null;
  }

  return parsedDate;
};

const saveBase64AttendanceImage = ({
  imagePayload,
  companyId,
  employeeId,
  punchType,
}) => {
  if (!imagePayload || !companyId || !employeeId) return null;

  const rawValue = String(imagePayload).trim();
  if (!rawValue) return null;

  const dataUrlMatch = rawValue.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  const mimeType = dataUrlMatch?.[1] || "image/jpeg";
  const base64Content = dataUrlMatch?.[2] || rawValue;

  let extension = ".jpg";
  if (mimeType.includes("png")) extension = ".png";
  if (mimeType.includes("webp")) extension = ".webp";

  try {
    const buffer = Buffer.from(base64Content, "base64");
    if (!buffer.length) return null;

    const uploadDir = path.join(
      __dirname,
      "..",
      "..",
      "uploads",
      "attendance",
      `company_${companyId}`
    );
    fs.mkdirSync(uploadDir, { recursive: true });

    const normalizedPunchType = String(punchType || "checkin").toLowerCase();
    const fileName = `emp${employeeId}-${normalizedPunchType}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}${extension}`;
    const absolutePath = path.join(uploadDir, fileName);
    fs.writeFileSync(absolutePath, buffer);

    return absolutePath;
  } catch (error) {
    console.error("Failed to save ESSL base64 image:", error);
    return null;
  }
};

const readHeader = (req, name) => {
  const value = req.headers?.[name];
  return Array.isArray(value) ? value[0] : value;
};

const parsePayload = (req) => {
  const employeeCode = String(
    req.body?.employee_code ??
      req.body?.employee_id ??
      req.body?.emp_code ??
      req.body?.UserID ??
      ""
  ).trim();
  const verifyType = String(
    req.body?.verify_type ??
      req.body?.verification_method ??
      req.body?.punch_type ??
      req.body?.punch?.method ??
      req.body?.VerifyType ??
      "biometric"
  ).trim();
  const punchType = String(
    req.body?.punch_type ??
      req.body?.direction ??
      req.body?.punch?.type ??
      req.body?.PunchState ??
      ""
  ).trim().toUpperCase();
  const machineSerial = String(
    req.body?.machine_serial ??
      req.body?.device_serial ??
      req.body?.device?.id ??
      req.body?.MachineSerial ??
      readHeader(req, "x-essl-device-id") ??
      ""
  ).trim();
  const deviceName = String(
    req.body?.device_name ??
      req.body?.device?.name ??
      ""
  ).trim();
  const deviceLocation = String(
    req.body?.location ??
      req.body?.device?.location ??
      ""
  ).trim();
  const companyCode = String(
    req.body?.company_code ??
      req.body?.company_id ??
      req.body?.organization_code ??
      req.body?.org_code ??
      readHeader(req, "x-company-code") ??
      readHeader(req, "x-organization-code") ??
      ""
  ).trim();
  const apiKey = String(
    req.body?.api_key ??
      req.body?.secret_key ??
      readHeader(req, "x-essl-key") ??
      readHeader(req, "x-api-key") ??
      ""
  ).trim();
  const punchTime = normalizePunchTime(
    req.body?.timestamp ??
      req.body?.punch_time ??
      req.body?.log_time ??
      req.body?.RecordTime
  );
  const faceImageBase64 =
    req.body?.face_image_base64 ??
    req.body?.image_base64 ??
    req.body?.image ??
    req.body?.snapshot_base64 ??
    req.body?.faceImageBase64 ??
    req.body?.punch?.image_base64 ??
    null;

  return {
    employeeCode,
    verifyType,
    punchType,
    machineSerial,
    deviceName,
    deviceLocation,
    companyCode,
    apiKey,
    punchTime,
    faceImageBase64,
  };
};

const normalizeVerifyType = (value) => {
  const normalized = String(value || "biometric").trim().toLowerCase();

  if (["finger", "fingerprint", "bio", "biometric", "thumb"].includes(normalized)) {
    return "biometric";
  }

  if (["card", "rfid", "accesscard", "access_card", "idcard", "id_card"].includes(normalized)) {
    return "card";
  }

  if (["face", "facial", "facerecognition", "face_recognition"].includes(normalized)) {
    return "face";
  }

  return normalized || "biometric";
};

const normalizePunchType = (value) => {
  const normalized = String(value || "").trim().toUpperCase();

  if (!normalized) return null;
  if (["IN", "CHECKIN", "CHECK_IN", "PUNCH_IN", "0"].includes(normalized)) return "IN";
  if (["OUT", "CHECKOUT", "CHECK_OUT", "PUNCH_OUT", "1"].includes(normalized)) return "OUT";

  return null;
};

const createDeviceInfo = ({ verifyType, machineSerial, deviceName, deviceLocation }) => {
  const mode = normalizeVerifyType(verifyType);
  const parts = ["ESSL", mode];

  if (machineSerial) parts.push(machineSerial);
  if (deviceName) parts.push(deviceName);
  if (deviceLocation) parts.push(deviceLocation);

  return parts.join("-");
};

const buildEmployeeQuery = (employeeCode, companyId) => {
  const query = knex("employees").where({ company_id: companyId });

  if (/^\d+$/.test(employeeCode)) {
    query.andWhere(function matchEmployee() {
      this.where("employee_id", employeeCode).orWhere("id", Number(employeeCode));
    });
    return query;
  }

  return query.andWhere("employee_id", employeeCode);
};

const secureCompare = (provided, expected) => {
  const providedBuffer = Buffer.from(String(provided || ""), "utf8");
  const expectedBuffer = Buffer.from(String(expected || ""), "utf8");

  if (providedBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(providedBuffer, expectedBuffer);
};

const resolveCompany = async ({ companyCode, apiKey }) => {
  if (!companyCode) return null;

  const company = await knex("companies")
    .where(function matchCompany() {
      this.where("company_id", companyCode).orWhere("id", companyCode);
    })
    .first();

  if (!company) {
    const error = new Error("Company not found for company_code");
    error.status = 404;
    throw error;
  }

  if (company.essl_enabled === false) {
    const error = new Error("ESSL integration is disabled for this company");
    error.status = 403;
    throw error;
  }

  if (company.essl_api_key) {
    if (!apiKey || !secureCompare(apiKey, company.essl_api_key)) {
      const error = new Error("Invalid ESSL API key");
      error.status = 403;
      throw error;
    }
  }

  return company;
};

const resolveEmployee = async ({ employeeCode, company }) => {
  if (!employeeCode) {
    const error = new Error("employee_code is required");
    error.status = 400;
    throw error;
  }

  let employee = null;

  if (company) {
    employee = await buildEmployeeQuery(employeeCode, company.id).first();
  } else {
    employee = await knex("employees")
      .where(function matchEmployee() {
        this.where("employee_id", employeeCode);
        if (/^\d+$/.test(employeeCode)) {
          this.orWhere("id", Number(employeeCode));
        }
      })
      .first();
  }

  if (!employee) {
    const error = new Error("Employee not found");
    error.status = 404;
    throw error;
  }

  return employee;
};

const resolveAttendanceContext = async (req) => {
  const payload = parsePayload(req);
  if (!payload.punchTime) {
    const error = new Error("Invalid timestamp");
    error.status = 400;
    throw error;
  }

  const company = await resolveCompany(payload);
  const employee = await resolveEmployee({
    employeeCode: payload.employeeCode,
    company,
  });
  const attendanceDay = payload.punchTime.toISOString().slice(0, 10);
  const active = await knex("attendance")
    .where({
      employee_id: employee.id,
      company_id: employee.company_id,
    })
    .whereNull("check_out")
    .whereRaw("DATE(check_in) = ?", [attendanceDay])
    .first();

  return {
    ...payload,
    company,
    employee,
    attendanceDay,
    active,
    deviceInfo: createDeviceInfo(payload),
    normalizedPunchType: normalizePunchType(payload.punchType),
    normalizedVerifyType: normalizeVerifyType(payload.verifyType),
    nextAction:
      normalizePunchType(payload.punchType) === "IN"
        ? "check_in"
        : normalizePunchType(payload.punchType) === "OUT"
          ? "check_out"
          : active
            ? "check_out"
            : "check_in",
  };
};

const esslHealth = async (req, res) => {
  return res.json({
    success: true,
    message: "ESSL webhook is ready",
    serverTime: new Date().toISOString(),
  });
};

const esslPunchTest = async (req, res) => {
  try {
    const context = await resolveAttendanceContext(req);

    return res.json({
      success: true,
      dryRun: true,
      nextAction: context.nextAction,
      company: {
        id: context.employee.company_id,
        company_code: context.company?.company_id || null,
        company_name: context.company?.company_name || null,
      },
      employee: {
        id: context.employee.id,
        employee_code: context.employee.employee_id,
        first_name: context.employee.first_name,
        last_name: context.employee.last_name,
      },
      verify_type: context.normalizedVerifyType,
      punch_type: context.normalizedPunchType,
      punch_time: context.punchTime.toISOString(),
      device_info: context.deviceInfo,
      image_received: Boolean(context.faceImageBase64),
      active_attendance_id: context.active?.id || null,
    });
  } catch (err) {
    console.error("ESSL test error:", err);
    return res.status(err.status || 500).json({
      success: false,
      message: err.message || "ESSL test error",
    });
  }
};

const esslPunch = async (req, res) => {
  try {
    const context = await resolveAttendanceContext(req);
    const punchImagePath = saveBase64AttendanceImage({
      imagePayload: context.faceImageBase64,
      companyId: context.employee.company_id,
      employeeId: context.employee.id,
      punchType: context.nextAction === "check_out" ? "checkout" : "checkin",
    });

    if (context.nextAction === "check_in") {
      if (context.active) {
        return res.status(409).json({
          success: false,
          message: "Employee already has an active check-in",
          action: "check_in",
        });
      }

      const attendance = await doCheckIn({
        employeeId: context.employee.id,
        companyId: context.employee.company_id,
        imageData: punchImagePath,
        deviceInfo: context.deviceInfo,
        punchTime: context.punchTime,
      });

      return res.json({
        success: true,
        action: "check_in",
        attendance,
      });
    }

    if (!context.active) {
      return res.status(409).json({
        success: false,
        message: "No active check-in found for check-out",
        action: "check_out",
      });
    }

    const checkoutResult = await doCheckOut({
      employeeId: context.employee.id,
      companyId: context.employee.company_id,
      imageData: punchImagePath,
      deviceInfo: context.deviceInfo,
      punchTime: context.punchTime,
    });

    return res.json({
      success: true,
      action: "check_out",
      attendance: checkoutResult.attendance,
    });
  } catch (err) {
    console.error("ESSL processing error:", err);
    return res.status(err.status || 500).json({
      success: false,
      message: err.message || "ESSL processing error",
    });
  }
};

module.exports = { esslHealth, esslPunchTest, esslPunch };
