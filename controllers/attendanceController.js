// src/controllers/attendanceController.js
const knex = require("../db/db");
const { getIo } = require("../socket");
const { hasAnyRole } = require("../middleware/authMiddleware");
const { doCheckIn, doCheckOut } = require("../services/attendance.service");
const { getEmployeeShift } = require("../utils/shift.util");
const { findEmployeeByFace } = require("../utils/faceRecognition");
const { reverseGeocodeGoogle } = require("../services/googleGeocode");
const { reverseGeocodeMappls } = require("../services/mapplsGeocode");
const { applyEmployeeAssignmentFilter } = require("../utils/clientAssignments");

const liveGeocodeHealth = {
  googleDisabled: false,
  mapplsDisabled: false,
  logged: new Set(),
};

const warnLiveGeocodeOnce = (key, ...args) => {
  if (liveGeocodeHealth.logged.has(key)) return;
  liveGeocodeHealth.logged.add(key);
  console.warn(...args);
};

const getPreferredGeocodeProvider = () => {
  const provider = String(process.env.GEOCODE_PROVIDER || "auto")
    .trim()
    .toLowerCase();
  return ["google", "mappls", "auto"].includes(provider) ? provider : "auto";
};

const reverseGeocodeForLiveTracking = async ({ latitude, longitude }) => {
  const provider = getPreferredGeocodeProvider();

  if (provider !== "mappls" && !liveGeocodeHealth.googleDisabled) {
    try {
      return await reverseGeocodeGoogle({ latitude, longitude });
    } catch (googleError) {
      if (
        ["GOOGLE_NOT_CONFIGURED", "GOOGLE_KEY_RESTRICTED"].includes(
          googleError?.code,
        )
      ) {
        liveGeocodeHealth.googleDisabled = true;
        warnLiveGeocodeOnce(
          "google-disabled",
          googleError.message,
          "Google live-tracking geocode disabled until backend restart.",
        );
      } else {
        warnLiveGeocodeOnce(
          `google-${googleError?.code || googleError?.statusText || "failed"}`,
          "Google reverse geocode failed:",
          googleError?.message || googleError,
        );
      }
    }
  }

  if (provider !== "google" && !liveGeocodeHealth.mapplsDisabled) {
    try {
      return await reverseGeocodeMappls({ latitude, longitude });
    } catch (mapplsError) {
      if (
        ["MAPPLS_NOT_CONFIGURED", "MAPPLS_AUTH_ERROR"].includes(
          mapplsError?.code,
        )
      ) {
        liveGeocodeHealth.mapplsDisabled = true;
        warnLiveGeocodeOnce(
          "mappls-disabled",
          mapplsError?.code === "MAPPLS_AUTH_ERROR"
            ? "Mappls reverse geocode failed (401). Mappls live-tracking geocode disabled until backend restart. Check MAPPLS_ACCESS_TOKEN."
            : "Mappls live-tracking geocode not configured.",
        );
      } else {
        warnLiveGeocodeOnce(
          `mappls-${mapplsError?.code || mapplsError?.status || "failed"}`,
          "Mappls reverse geocode failed:",
          mapplsError?.message || mapplsError,
        );
      }
    }
  }

  return null;
};

// Resolve the real employees.id for the logged-in user.
// - employee login: req.user.id already points to employees.id
// - admin login: req.user.id points to users.id, so map by email + company
const resolveAttendanceEmployeeId = async (req) => {
  const companyId = Number(req.user?.company_id);
  if (!companyId) {
    throw new Error("Company not assigned to user");
  }

  if (req.user?.employee_id) {
    const employee = await knex("employees")
      .where({ id: Number(req.user.employee_id), company_id: companyId })
      .first();
    if (employee) return Number(employee.id);
  }

  // Employee token path (already employees.id)
  if (req.user?.type === "employee") {
    const employee = await knex("employees")
      .where({ id: Number(req.user.id), company_id: companyId })
      .first();
    if (employee) return Number(employee.id);
  }

  // Admin token path (users.id -> employees.id by email)
  if (req.user?.type === "admin" && req.user?.email) {
    const employee = await knex("employees")
      .where("company_id", companyId)
      .whereRaw("LOWER(email) = ?", [
        String(req.user.email).toLowerCase().trim(),
      ])
      .first();
    if (employee) return Number(employee.id);
  }

  // Last fallback: try req.user.id directly as employee id
  const fallbackEmployee = await knex("employees")
    .where({ id: Number(req.user?.id), company_id: companyId })
    .first();
  if (fallbackEmployee) return Number(fallbackEmployee.id);

  const error = new Error("Employee profile not found for this account");
  error.code = "ATTENDANCE_EMPLOYEE_PROFILE_NOT_FOUND";
  error.statusCode = 404;
  throw error;
};

const getDayWindow = (date = new Date()) => {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  return { start, end };
};

const normalizeRequestedTime = (value) => {
  const normalized = String(value || "").trim();
  if (!normalized) return null;
  const match = normalized.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = match[3] ? Number(match[3]) : 0;

  if (hours > 23 || minutes > 59 || seconds > 59) return null;

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
};

const buildDateTime = (date, time) => `${date} ${time}`;

const formatDateOnly = (value) => {
  if (!value) return null;
  const text = String(value);
  const dateMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (dateMatch) return `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`;

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;

  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const calculateWorkedHours = (date, checkInTime, checkOutTime) => {
  const checkInDate = new Date(`${date}T${checkInTime}`);
  const checkOutDate = new Date(`${date}T${checkOutTime}`);

  if (
    Number.isNaN(checkInDate.getTime()) ||
    Number.isNaN(checkOutDate.getTime())
  ) {
    return null;
  }

  if (checkOutDate <= checkInDate) {
    checkOutDate.setDate(checkOutDate.getDate() + 1);
  }

  return Math.max(0, (checkOutDate - checkInDate) / (1000 * 60 * 60));
};

const buildAttendanceOverrideUpdate = ({ override, date }) => {
  const requestedCheckIn = normalizeRequestedTime(override.requested_check_in);
  const requestedCheckOut = normalizeRequestedTime(
    override.requested_check_out,
  );
  const updatePayload = {
    status: override.overridden_status,
  };

  if (requestedCheckIn) {
    updatePayload.check_in = buildDateTime(date, requestedCheckIn);
  }

  if (requestedCheckOut) {
    updatePayload.check_out = buildDateTime(date, requestedCheckOut);
  }

  if (requestedCheckIn && requestedCheckOut) {
    const workedHours = calculateWorkedHours(
      date,
      requestedCheckIn,
      requestedCheckOut,
    );
    if (workedHours !== null) {
      updatePayload.hours_worked = workedHours;
      updatePayload.overtime_hours = 0;
    }
  }

  return updatePayload;
};

const getAttendanceDate = (attendance, fallbackDate) => {
  if (fallbackDate) return fallbackDate;
  if (attendance?.attendance_date) return attendance.attendance_date;
  if (!attendance?.check_in) return null;
  return formatDateOnly(attendance.check_in);
};

const getAttendanceDateById = async (companyId, attendanceId) => {
  if (!attendanceId) return null;
  const row = await knex("attendance")
    .where({ id: attendanceId, company_id: companyId })
    .select(knex.raw("DATE_FORMAT(check_in, '%Y-%m-%d') as attendance_date"))
    .first();
  return row?.attendance_date || null;
};

const calculateDistanceMeters = (lat1, lon1, lat2, lon2) => {
  const toRad = (value) => (Number(value) * Math.PI) / 180;
  const earthRadiusMeters = 6371000;
  const dLat = toRad(lat2) - toRad(lat1);
  const dLon = toRad(lon2) - toRad(lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return 2 * earthRadiusMeters * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const parseLocationFromRequest = (req) => {
  let parsedLocation = null;
  if (req.body?.location) {
    try {
      parsedLocation =
        typeof req.body.location === "string"
          ? JSON.parse(req.body.location)
          : req.body.location;
    } catch {
      parsedLocation = null;
    }
  }

  const latitude = Number(req.body?.latitude ?? parsedLocation?.latitude);
  const longitude = Number(req.body?.longitude ?? parsedLocation?.longitude);

  return {
    latitude,
    longitude,
    isValid: Number.isFinite(latitude) && Number.isFinite(longitude),
  };
};

const validateAssignedClientLocationForCheckIn = async ({
  req,
  companyId,
  employeeId,
}) => {
  const selectedClientIdRaw = req.body?.clientId ?? req.body?.client_id;
  const selectedClientId =
    selectedClientIdRaw === undefined || selectedClientIdRaw === null
      ? null
      : Number(selectedClientIdRaw);

  if (
    selectedClientIdRaw !== undefined &&
    selectedClientIdRaw !== null &&
    !Number.isInteger(selectedClientId)
  ) {
    const error = new Error("Valid selected client is required for check-in");
    error.statusCode = 400;
    throw error;
  }

  const assignedClientsQuery = knex("clients")
    .where("clients.company_id", companyId)
    .select(
      "clients.id",
      "clients.client_name",
      "clients.geo_latitude",
      "clients.geo_longitude",
      "clients.geo_radius",
    );

  await applyEmployeeAssignmentFilter(assignedClientsQuery, {
    clientTable: "clients",
    employeeId,
  });

  if (selectedClientId) {
    assignedClientsQuery.where("clients.id", selectedClientId);
  }

  const assignedClients = await assignedClientsQuery;

  if (!assignedClients.length) {
    if (selectedClientId) {
      const error = new Error("Selected client is not assigned to this user");
      error.statusCode = 400;
      throw error;
    }

    return null;
  }

  if (!selectedClientId) {
    // Work-from-home or non-client check-in flow: allow attendance without forcing
    // the employee to be inside a specific assigned client geofence.
    return null;
  }

  const clientsWithLocation = assignedClients.filter(
    (client) =>
      Number.isFinite(Number(client.geo_latitude)) &&
      Number.isFinite(Number(client.geo_longitude)),
  );

  if (!clientsWithLocation.length) {
    const error = new Error(
      "Assigned client location is not configured. Please contact admin.",
    );
    error.statusCode = 400;
    throw error;
  }

  const employeeLocation = parseLocationFromRequest(req);
  if (!employeeLocation.isValid) {
    const error = new Error("Valid current location is required for check-in");
    error.statusCode = 400;
    throw error;
  }

  const clientDistances = clientsWithLocation
    .map((client) => {
      const distance = calculateDistanceMeters(
        employeeLocation.latitude,
        employeeLocation.longitude,
        client.geo_latitude,
        client.geo_longitude,
      );
      const radius = Number(client.geo_radius) || 50;

      return {
        clientId: client.id,
        clientName: client.client_name,
        distance: Math.round(distance),
        radius,
        withinFence: distance <= radius,
      };
    })
    .sort((a, b) => a.distance - b.distance);

  const matchedClient = clientDistances.find((client) => client.withinFence);
  if (!matchedClient) {
    const nearestClient = clientDistances[0];
    const error = new Error(
      selectedClientId && nearestClient
        ? `You are outside ${nearestClient.clientName}'s location. You are ${nearestClient.distance}m away (Allowed: ${nearestClient.radius}m)`
        : nearestClient
          ? `You are outside assigned client locations. Nearest: ${nearestClient.clientName}, ${nearestClient.distance}m away (Allowed: ${nearestClient.radius}m)`
          : "You are outside assigned client locations",
    );
    error.statusCode = 400;
    throw error;
  }

  return matchedClient;
};

// Check current attendance status
const getAttendanceStatus = async (req, res) => {
  try {
    const companyId = Number(req.user.company_id);
    if (!companyId && hasAnyRole(req.user, ["superadmin"])) {
      return res.json({
        success: true,
        isCheckedIn: false,
        hasCheckedInToday: false,
        todayRecords: [],
        message: "Super admin is not assigned to a company",
      });
    }

    const employeeId = await resolveAttendanceEmployeeId(req);

    const { start: todayStart, end: tomorrowStart } = getDayWindow();

    const activeAttendance = await knex("attendance")
      .where("employee_id", employeeId)
      .where("company_id", companyId)
      .where("check_in", ">=", todayStart)
      .where("check_in", "<", tomorrowStart)
      .whereNull("check_out")
      .first();

    const todayAttendance = await knex("attendance")
      .where("employee_id", employeeId)
      .where("company_id", companyId)
      .where("check_in", ">=", todayStart)
      .where("check_in", "<", tomorrowStart)
      .orderBy("check_in", "desc")
      .limit(2);

    res.json({
      success: true,
      isCheckedIn: !!activeAttendance,
      hasCheckedInToday: todayAttendance.some((record) =>
        Boolean(record.check_in),
      ),
      todayRecords: todayAttendance || [],
    });
  } catch (error) {
    if (error.code === "ATTENDANCE_EMPLOYEE_PROFILE_NOT_FOUND") {
      return res.json({
        success: true,
        isCheckedIn: false,
        hasCheckedInToday: false,
        todayRecords: [],
        attendanceUnavailable: true,
        message: error.message,
      });
    }

    console.error("Error fetching attendance status:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch attendance status",
    });
  }
};

const getAssignedAttendanceClients = async (req, res) => {
  try {
    const companyId = Number(req.user?.company_id);
    const employeeId = await resolveAttendanceEmployeeId(req);

    if (!companyId || !employeeId) {
      return res.status(400).json({
        success: false,
        message: "Missing employee or company context",
      });
    }

    const query = knex("clients")
      .where("clients.company_id", companyId)
      .select(
        "clients.id",
        "clients.client_id",
        "clients.client_name",
        "clients.address",
        "clients.geo_latitude",
        "clients.geo_longitude",
        "clients.geo_radius",
      );

    await applyEmployeeAssignmentFilter(query, {
      clientTable: "clients",
      employeeId,
    });

    const clients = await query.orderBy("clients.client_name", "asc");

    return res.json({
      success: true,
      data: clients,
    });
  } catch (error) {
    console.error("Get assigned attendance clients error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch assigned clients",
    });
  }
};

const validateCheckInLocation = async (req, res) => {
  try {
    const companyId = Number(req.user?.company_id);
    const employeeId = await resolveAttendanceEmployeeId(req);

    if (!companyId || !employeeId) {
      return res.status(400).json({
        success: false,
        message: "Missing employee or company context",
      });
    }

    const matchedClient = await validateAssignedClientLocationForCheckIn({
      req,
      companyId,
      employeeId,
    });

    return res.json({
      success: true,
      requiresClientLocation: Boolean(matchedClient),
      matchedClient,
    });
  } catch (err) {
    if (err.statusCode && err.statusCode < 500) {
      console.warn("Check-in location blocked:", err.message);
    } else {
      console.error("Check-in location validation error:", err);
    }

    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.statusCode ? err.message : "Failed to validate location",
      error: err.message,
    });
  }
};

// Check-in employee
// const checkIn = async (req, res) => {
//   const companyId = req.user.company_id;
//   if (!companyId) {
//     return res.status(400).json({ message: 'Company not assigned to user' });
//   }

//   // Handle FormData - get fields from req.body and file from req.file
//   const employeeId = req.body.employeeId;
//   const imageData = req.file; // For FormData, file comes from req.file
//   const location = req.body.location ? JSON.parse(req.body.location) : null;
//   const deviceInfo = req.body.deviceInfo;
//   const userId = req.user.id;

//   try {
//     // Verify employee belongs to same company
//     const employee = await knex('employees')
//       .where({ id: employeeId, company_id: companyId })
//       .first();

//     if (!employee) {
//       return res.status(404).json({ message: 'Employee not found or access denied' });
//     }

//     // Verify face if image data is provided
//     if (imageData) {
//       const faceMatch = await verifyFace(employeeId, imageData);
//       if (!faceMatch) {
//         return res.status(400).json({ message: 'Face verification failed' });
//       }
//     }

//     // Check if already checked in today
//     const today = new Date();
//     today.setHours(0, 0, 0, 0);

//     const existingCheckIn = await knex('attendance')
//       .where('employee_id', employeeId)
//       .where('company_id', companyId)
//       .where('check_in', '>=', today)
//       .whereNull('check_out')
//       .first();

//     if (existingCheckIn) {
//       return res.status(400).json({ message: 'Already checked in today' });
//     }

//     // Get employee shift information
//     const employeeShift = await getEmployeeShift(employeeId, companyId);

//     // Determine shift type
//     const shiftType = determineShiftType(new Date(), employeeShift);

//     // Create attendance record
//     const [attendance] = await knex('attendance')
//       .insert({
//         company_id: companyId, // ← Company isolation
//         employee_id: employeeId,
//         check_in: new Date(),
//         check_in_location: location ? JSON.stringify(location) : null,
//         check_in_image_url: imageData ? await saveImage(imageData) : null,
//         device_info: deviceInfo || 'Web',
//         status: 'present',
//         shift_type: shiftType,
//         shift_id: employeeShift?.shift_id || null
//       })
//       .returning('*');

//     // Log check-in
//     // await logAudit('check_in', 'attendance', attendance.id, userId, {
//     //   employee_id: employeeId,
//     //   check_in: attendance.check_in
//     // });

//     res.status(201).json({
//       success: true,
//       message: 'Checked in successfully',
//       attendance
//     });
//   } catch (error) {
//     console.error('Check-in error:', error);
//     res.status(500).json({ message: 'Error processing check-in' });
//   }
// };

// // Check-out employee
// const checkOut = async (req, res) => {
//   const companyId = req.user.company_id;
//   if (!companyId) {
//     return res.status(400).json({ message: 'Company not assigned to user' });
//   }

//   // Handle FormData - get fields from req.body and file from req.file
//   const imageData = req.file; // For FormData, file comes from req.file
//   const location = req.body.location ? JSON.parse(req.body.location) : null;
//   const deviceInfo = req.body.deviceInfo;
//   const employeeId = req.user.id;

//   try {
//     // Find today's active check-in for this employee in company
//     const checkInRecord = await knex('attendance')
//       .where({
//         employee_id: employeeId,
//         company_id: companyId
//       })
//       .whereNull('check_out')
//       .whereRaw('DATE(check_in) = CURDATE()')
//       .first();

//     if (!checkInRecord) {
//       return res.status(400).json({ message: 'No active check-in found for today' });
//     }

//     // Get employee shift information for overtime calculation
//     const employeeShift = await getEmployeeShift(employeeId, companyId);

//     // Face verification (optional)
//     if (imageData) {
//       const faceMatch = await verifyFace(employeeId, imageData);
//       if (!faceMatch) {
//         return res.status(400).json({ message: 'Face verification failed' });
//       }
//     }

//     // Calculate hours based on shift
//     const checkOutTime = new Date();
//     const checkInTime = new Date(checkInRecord.check_in);
//     let hoursWorked = (checkOutTime - checkInTime) / (1000 * 60 * 60);

//     // Ensure minimum of 1 minute worked if check-out is same as check-in
//     if (hoursWorked < 0.0167) { // Less than 1 minute
//       hoursWorked = 0.0167; // Set to 1 minute
//     }

//     console.log('Hours calculation debug:', {
//       checkOutTime: checkOutTime.toISOString(),
//       checkInTime: checkInTime.toISOString(),
//       hoursWorked: hoursWorked,
//       checkInRecord: checkInRecord
//     });

//     // Use shift duration for standard hours if available, otherwise default to 8
//     let standardHours = 8;
//     if (employeeShift && employeeShift.start_time && employeeShift.end_time) {
//       const [startHour, startMin] = employeeShift.start_time.split(':').map(Number);
//       const [endHour, endMin] = employeeShift.end_time.split(':').map(Number);
//       const startTime = new Date();
//       startTime.setHours(startHour, startMin, 0, 0);
//       const endTime = new Date();
//       endTime.setHours(endHour, endMin, 0, 0);

//       // Handle overnight shifts
//       if (endTime < startTime) {
//         endTime.setDate(endTime.getDate() + 1);
//       }

//       standardHours = (endTime - startTime) / (1000 * 60 * 60);
//     }

//     const overtimeHours = Math.max(0, hoursWorked - standardHours);

//     console.log('Final hours to save:', {
//       hoursWorked: hoursWorked,
//       overtimeHours: overtimeHours
//     });

//     // Update attendance
//     await knex('attendance')
//       .where('id', checkInRecord.id)
//       .update({
//         check_out: checkOutTime,
//         check_out_location: location ? JSON.stringify(location) : null,
//         check_out_image_url: imageData ? await saveImage(imageData) : null,
//         hours_worked: hoursWorked,
//         overtime_hours: overtimeHours,
//         device_info: deviceInfo || 'Web'
//       });

//     const updatedAttendance = await knex('attendance')
//       .where('id', checkInRecord.id)
//       .first();

//     // Audit log
//     // await logAudit(
//     //   'check_out',
//     //   'attendance',
//     //   updatedAttendance.id,
//     //   req.user.id,
//     //   {
//     //     employee_id: employeeId,
//     //     check_out: updatedAttendance.check_out,
//     //     hours_worked: updatedAttendance.hours_worked
//     //   }
//     // );

//     return res.json({
//       success: true,
//       message: 'Checked out successfully',
//       attendance: updatedAttendance
//     });

//   } catch (error) {
//     console.error('Check-out error:', error);
//     return res.status(500).json({ message: 'Error processing check-out' });
//   }
// };

const checkIn = async (req, res) => {
  try {
    // 1️⃣ Resolve employeeId + companyId from authenticated user context
    const employeeId = await resolveAttendanceEmployeeId(req);
    const companyId = Number(req.user?.company_id);

    // 2️⃣ Validate inputs
    if (!employeeId || !companyId) {
      return res.status(400).json({
        success: false,
        message: "Missing or invalid employeeId or companyId",
      });
    }

    console.log("Check-in called with:", { employeeId, companyId });

    await validateAssignedClientLocationForCheckIn({
      req,
      companyId,
      employeeId,
    });

    // 3️⃣ Fetch shift if assigned. Do not block check-in when shift is missing
    // (e.g. admin users without shift assignment).
    const shift = await getEmployeeShift(employeeId, companyId);
    if (!shift) {
      console.warn("Check-in without assigned shift:", {
        employeeId,
        companyId,
      });
    }

    // 4️⃣ Insert attendance record
    const attendance = await doCheckIn({
      employeeId: employeeId,
      companyId: companyId,
      imageData: req.file?.path || null,
      location: req.body.location ? JSON.parse(req.body.location) : null,
      deviceInfo: "Web",
      shiftId: shift?.id || null,
      shiftType: "regular", // Use string that will be converted to numeric
    });

    // 5️⃣ Return success
    res.json({ success: true, attendance });
  } catch (err) {
    if (err.statusCode && err.statusCode < 500) {
      console.warn("Check-in blocked:", err.message);
    } else {
      console.error("Check-in error:", err);
    }
    const isDuplicateCheckIn = err.message === "Already checked in today";
    res.status(err.statusCode || (isDuplicateCheckIn ? 400 : 500)).json({
      success: false,
      message:
        err.statusCode || isDuplicateCheckIn
          ? err.message
          : "Failed to check in",
      error: err.message,
    });
  }
};

const checkOut = async (req, res) => {
  try {
    const employeeId = await resolveAttendanceEmployeeId(req);
    await doCheckOut({
      employeeId,
      companyId: req.user.company_id,
      imageData: req.file?.path || null,
      location: req.body.location ? JSON.parse(req.body.location) : null,
      deviceInfo: "Web",
    });

    res.json({ success: true, message: "Checked out successfully" });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

const parseOptionalLocation = (rawLocation) => {
  if (!rawLocation) return null;
  if (typeof rawLocation === "object") return rawLocation;
  try {
    return JSON.parse(rawLocation);
  } catch {
    return null;
  }
};

const resolveFacialAttendanceAction = async ({ companyId, employeeId }) => {
  const { start: todayStart, end: tomorrowStart } = getDayWindow();

  const activeAttendance = await knex("attendance")
    .where("employee_id", employeeId)
    .where("company_id", companyId)
    .where("check_in", ">=", todayStart)
    .where("check_in", "<", tomorrowStart)
    .whereNull("check_out")
    .first();

  if (activeAttendance) return "check-out";

  const completedAttendance = await knex("attendance")
    .where("employee_id", employeeId)
    .where("company_id", companyId)
    .where("check_in", ">=", todayStart)
    .where("check_in", "<", tomorrowStart)
    .whereNotNull("check_out")
    .first();

  if (completedAttendance) {
    const error = new Error("Employee has already completed attendance today");
    error.statusCode = 400;
    throw error;
  }

  return "check-in";
};

const facialRecognitionAttendance = async (req, res) => {
  try {
    const companyId = Number(req.user?.company_id);
    const requestedAction = String(req.body?.action || "auto")
      .trim()
      .toLowerCase();

    if (!companyId) {
      return res.status(400).json({
        success: false,
        message: "Company not assigned to user",
      });
    }

    if (!["auto", "check-in", "check-out"].includes(requestedAction)) {
      return res.status(400).json({
        success: false,
        message: "Action must be auto, check-in, or check-out",
      });
    }

    if (!req.file?.path) {
      return res.status(400).json({
        success: false,
        message: "Face image is required",
      });
    }

    const match = await findEmployeeByFace(companyId, req.file.path);
    const employeeId = Number(match.employee.id);
    const action =
      requestedAction === "auto"
        ? await resolveFacialAttendanceAction({ companyId, employeeId })
        : requestedAction;
    const location = parseOptionalLocation(req.body.location);
    const deviceInfo = "Admin Facial Recognition";

    let attendance = null;
    if (action === "check-in") {
      const shift = await getEmployeeShift(employeeId, companyId);
      attendance = await doCheckIn({
        employeeId,
        companyId,
        imageData: req.file.path,
        location,
        deviceInfo,
        shiftId: shift?.id || null,
        shiftType: "regular",
      });
    } else {
      await doCheckOut({
        employeeId,
        companyId,
        imageData: req.file.path,
        location,
        deviceInfo,
      });
    }

    return res.json({
      success: true,
      message:
        action === "check-in"
          ? "Employee checked in successfully"
          : "Employee checked out successfully",
      action,
      employee: {
        id: match.employee.id,
        employee_id: match.employee.employee_id,
        first_name: match.employee.first_name,
        last_name: match.employee.last_name,
        email: match.employee.email,
        status: match.employee.status,
      },
      faceMatch: {
        confidence: match.confidence,
        distance: match.distance,
        threshold: match.threshold,
        comparedEmployees: match.comparedEmployees,
        skippedEmployees: match.skippedEmployees,
      },
      attendance,
    });
  } catch (err) {
    if (err.code === "FACE_MODELS_NOT_LOADED") {
      return res.status(503).json({
        success: false,
        message:
          "Face-api model files are missing on the server. Employee photos are read from uploads/employees/company_<id>, but recognition also needs model weights in HRMS/models or FACE_MODEL_DIR.",
        error: err.message,
      });
    }

    if (err.statusCode && err.statusCode < 500) {
      console.warn("Facial attendance blocked:", err.message);
    } else {
      console.error("Facial attendance error:", err);
    }

    const duplicateOrMissing =
      err.message === "Already checked in today" ||
      err.message === "No active check-in";

    return res.status(err.statusCode || (duplicateOrMissing ? 400 : 500)).json({
      success: false,
      message:
        err.statusCode || duplicateOrMissing
          ? err.message
          : "Failed to process facial attendance",
      error: err.message,
    });
  }
};

// const getAttendanceLogs = async (req, res) => {
//   const companyId = req.user.company_id;
//   if (!companyId) {
//     return res.status(400).json({ message: 'Company not assigned to user' });
//   }

//   const {
//     employeeId,
//     startDate,
//     endDate,
//     status,
//     page = 1,
//     limit = 10
//   } = req.query;

//   const pageNum = parseInt(page, 10);
//   const limitNum = parseInt(limit, 10);
//   const offset = (pageNum - 1) * limitNum;

//   try {
//     let baseQuery = knex('attendance')
//       .leftJoin('employees', 'attendance.employee_id', 'employees.id')
//       .where('attendance.company_id', companyId);

//     // 🔐 ACCESS CONTROL
//     // Only ADMIN can see all employees
//     // Any user with type = 'employee' (manager/hr/finance/employee)
//     // can see ONLY their own attendance
//     if (req.user.type === 'employee' && req.user.role !== 'admin') {
//       baseQuery = baseQuery.where(
//         'attendance.employee_id',
//         req.user.id
//       );
//     }

//     // 🔹 Filters (ADMIN ONLY for employeeId)
//     if (employeeId && req.user.role === 'admin') {
//       baseQuery.where('attendance.employee_id', employeeId);
//     }

//     if (startDate) {
//       baseQuery.whereRaw(
//         'DATE(attendance.check_in) >= ?',
//         [startDate]
//       );
//     }

//     if (endDate) {
//       baseQuery.whereRaw(
//         'DATE(attendance.check_in) <= ?',
//         [endDate]
//       );
//     }

//     if (status) {
//       baseQuery.where('attendance.status', status);
//     }

//     // 🔹 Count query
//     const countResult = await baseQuery
//       .clone()
//       .count('attendance.id as count')
//       .first();

//     const total = parseInt(countResult.count, 10) || 0;

//     // 🔹 Data query
//     const data = await baseQuery
//       .clone()
//       .select(
//         'attendance.*',
//         'employees.first_name',
//         'employees.last_name',
//         'employees.employee_id as employee_code',
//         'attendance.hours_worked',
//         'attendance.overtime_hours'
//       )
//       .orderBy('attendance.check_in', 'desc')
//       .limit(limitNum)
//       .offset(offset);

//     res.json({
//       success: true,
//       count: total,
//       pagination: {
//         page: pageNum,
//         limit: limitNum,
//         totalPages: Math.ceil(total / limitNum)
//       },
//       data
//     });
//   } catch (error) {
//     console.error('Get attendance logs error:', error);
//     res.status(500).json({ message: 'Error fetching attendance logs' });
//   }
// };

// Create attendance override (company scoped)

const getAttendanceLogs = async (req, res) => {
  const companyId = req.user.company_id;
  if (!companyId) {
    return res.status(400).json({ message: "Company not assigned to user" });
  }

  const {
    employeeId,
    startDate,
    endDate,
    status,
    page = 1,
    limit = 10,
  } = req.query;

  const pageNum = parseInt(page, 10);
  const limitNum = parseInt(limit, 10);
  const offset = (pageNum - 1) * limitNum;

  try {
    // ===============================
    // Get logged in user info
    // ===============================
    let loggedInUser = null;

    const hasCompanyWideAccess = hasAnyRole(req.user, [
      "admin",
      "hr",
      "finance",
      "ceo",
      "superadmin",
    ]);
    if (!hasCompanyWideAccess) {
      loggedInUser = await knex("employees")
        .where({ id: req.user.id, company_id: companyId })
        .first();

      if (!loggedInUser) {
        return res.status(403).json({ message: "User not found" });
      }
    }

    // ===============================
    // Base query
    // ===============================
    let baseQuery = knex("attendance as a")
      .leftJoin("employees as e", "a.employee_id", "e.id")
      .where("a.company_id", companyId);

    // ===============================
    // Access Control
    // ===============================
    if (hasCompanyWideAccess) {
      // Admin → all employees, no restriction
    } else if (hasAnyRole(loggedInUser, ["manager"])) {
      // Manager → self + same department
      baseQuery.where(function () {
        this.where("e.department_id", loggedInUser.department_id).orWhere(
          "a.employee_id",
          loggedInUser.id,
        );
      });
    } else {
      // Employee / HR / Finance → only self
      baseQuery.where("a.employee_id", loggedInUser.id);
    }

    // ===============================
    // Filters
    // ===============================
    if (
      employeeId &&
      (hasCompanyWideAccess || hasAnyRole(loggedInUser, ["manager"]))
    ) {
      baseQuery.where("a.employee_id", employeeId);
    }

    if (startDate) {
      baseQuery.whereRaw("DATE(a.check_in) >= ?", [startDate]);
    }

    if (endDate) {
      baseQuery.whereRaw("DATE(a.check_in) <= ?", [endDate]);
    }

    if (status) {
      baseQuery.where("a.status", status);
    }

    // ===============================
    // Count query
    // ===============================
    const countResult = await baseQuery.clone().count("a.id as count").first();

    const total = parseInt(countResult.count, 10) || 0;

    // ===============================
    // Data query
    // ===============================
    const data = await baseQuery
      .clone()
      .select(
        "a.*",
        "e.first_name",
        "e.last_name",
        "e.employee_id as employee_code",
        "a.hours_worked",
        "a.overtime_hours",
        knex.raw("DATE_FORMAT(a.check_in, '%Y-%m-%d') as attendance_date"),
      )
      .orderBy("a.check_in", "desc")
      .limit(limitNum)
      .offset(offset);

    // ===============================
    // Response
    // ===============================
    res.json({
      success: true,
      count: total,
      pagination: {
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum),
      },
      data,
    });
  } catch (error) {
    console.error("Get attendance logs error:", error);
    res.status(500).json({ message: "Error fetching attendance logs" });
  }
};

// Get employee monthly attendance for payroll (company scoped)
const getAttendanceByEmployeeAndMonth = async (req, res) => {
  const companyId = req.user.company_id;
  if (!companyId) {
    return res.status(400).json({ message: "Company not assigned to user" });
  }

  const { employeeId, month } = req.params;
  if (!employeeId || !month) {
    return res.status(400).json({ message: "Employee and month are required" });
  }

  const match = String(month).match(/^(\d{4})-(\d{2})$/);
  if (!match) {
    return res
      .status(400)
      .json({ message: "Invalid month format. Expected YYYY-MM" });
  }

  const year = Number(match[1]);
  const monthNum = Number(match[2]);
  if (monthNum < 1 || monthNum > 12) {
    return res
      .status(400)
      .json({ message: "Invalid month value. Expected 01-12" });
  }

  const startDate = new Date(year, monthNum - 1, 1, 0, 0, 0, 0);
  const endDate = new Date(year, monthNum, 0, 23, 59, 59, 999);

  try {
    // Resolve employee by employee_id (code) first; fall back to numeric DB id.
    let employee = await knex("employees")
      .where({ employee_id: employeeId, company_id: companyId })
      .first();

    if (!employee && /^\d+$/.test(String(employeeId))) {
      employee = await knex("employees")
        .where({ id: Number(employeeId), company_id: companyId })
        .first();
    }

    if (!employee) {
      return res
        .status(404)
        .json({ message: "Employee not found or access denied" });
    }

    // 🔒 Access control: admin/hr/finance can view any; manager can view dept+self; others self only.
    if (
      !hasAnyRole(req.user, ["admin", "hr", "finance", "ceo", "superadmin"])
    ) {
      const loggedInEmployee = await knex("employees")
        .where({ id: req.user.id, company_id: companyId })
        .first();

      if (!loggedInEmployee) {
        return res.status(403).json({ message: "User not found" });
      }

      if (hasAnyRole(loggedInEmployee, ["manager"])) {
        const sameDepartment =
          employee.department_id &&
          employee.department_id === loggedInEmployee.department_id;
        const isSelf = employee.id === loggedInEmployee.id;
        if (!sameDepartment && !isSelf) {
          return res.status(403).json({ message: "Access denied" });
        }
      } else if (employee.id !== loggedInEmployee.id) {
        return res.status(403).json({ message: "Access denied" });
      }
    }

    const attendance = await knex("attendance")
      .where({ employee_id: employee.id, company_id: companyId })
      .whereBetween("check_in", [
        startDate.toISOString(),
        endDate.toISOString(),
      ])
      .orderBy("check_in", "asc");

    return res.json({
      success: true,
      attendance,
    });
  } catch (error) {
    console.error("Get monthly attendance error:", error);
    return res.status(500).json({ message: "Error fetching attendance" });
  }
};

const createOverride = async (req, res) => {
  const companyId = req.user.company_id;
  if (!companyId) {
    return res.status(400).json({ message: "Company not assigned to user" });
  }

  const {
    attendanceId,
    employeeId,
    date,
    originalStatus,
    overriddenStatus,
    reason,
    requestedCheckIn,
    requestedCheckOut,
    leaveMode,
  } = req.body;
  const userId = req.user.id;

  try {
    if (!reason || !String(reason).trim()) {
      return res.status(400).json({ message: "Reason is required" });
    }

    if (!employeeId || !String(employeeId).trim()) {
      return res.status(400).json({ message: "Employee ID is required" });
    }

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(String(date))) {
      return res
        .status(400)
        .json({ message: "Valid date is required (YYYY-MM-DD)" });
    }

    const normalizedRequestedCheckIn = normalizeRequestedTime(requestedCheckIn);
    const normalizedRequestedCheckOut =
      normalizeRequestedTime(requestedCheckOut);
    const normalizedLeaveMode = String(leaveMode || "none").toLowerCase();
    const isLeaveOverride =
      ["paid", "half"].includes(normalizedLeaveMode) ||
      /^\[(Paid Leave|Half Day Leave)\s+-\s+/i.test(
        String(reason || "").trim(),
      );
    const requiresTimeUpdate =
      ["present", "half", "half_day"].includes(
        String(overriddenStatus || "").toLowerCase(),
      ) && !isLeaveOverride;

    if (
      requiresTimeUpdate &&
      (!normalizedRequestedCheckIn || !normalizedRequestedCheckOut)
    ) {
      return res.status(400).json({
        message: "Valid requested check-in and check-out times are required",
      });
    }

    let attendance = null;
    const normalizedEmployeeId = String(employeeId).trim();
    const employeeQuery = knex("employees")
      .where({ company_id: companyId })
      .andWhere((qb) => {
        qb.whereRaw("LOWER(employee_id) = LOWER(?)", [normalizedEmployeeId]);
        if (!Number.isNaN(Number(normalizedEmployeeId))) {
          qb.orWhere("id", Number(normalizedEmployeeId));
        }
      })
      .first();

    const employee = await employeeQuery;

    if (!employee) {
      return res
        .status(404)
        .json({ message: "Employee not found in this company" });
    }

    // Backward compatible path: use attendanceId when available
    if (attendanceId) {
      attendance = await knex("attendance")
        .where({
          id: attendanceId,
          company_id: companyId,
          employee_id: employee.id,
        })
        .first();

      const attendanceIdDate = attendance
        ? await getAttendanceDateById(companyId, attendance.id)
        : null;
      if (attendanceIdDate && attendanceIdDate !== date) {
        attendance = null;
      }
    }

    // Resolve attendance by employee + selected date
    if (!attendance) {
      attendance = await knex("attendance")
        .where({
          company_id: companyId,
          employee_id: employee.id,
        })
        .whereRaw("DATE(check_in) = ?", [date])
        .orderByRaw("CASE WHEN device_info = 'Override' THEN 1 ELSE 0 END ASC")
        .orderBy("check_in", "desc")
        .first();
    }

    // If no row exists for selected date, create a placeholder attendance row for that date.
    if (!attendance) {
      const seedStatus = (originalStatus || "absent").toLowerCase();
      const insertedAttendance = await knex("attendance").insert({
        company_id: companyId,
        employee_id: employee.id,
        check_in: `${date} 00:00:00`,
        check_out: null,
        hours_worked: 0,
        overtime_hours: 0,
        status: seedStatus,
        device_info: "Override",
        auto_flag: 0,
      });

      const insertedAttendanceRaw = Array.isArray(insertedAttendance)
        ? insertedAttendance[0]
        : insertedAttendance;
      const insertedAttendanceId =
        typeof insertedAttendanceRaw === "object"
          ? insertedAttendanceRaw.id
          : insertedAttendanceRaw;
      attendance = await knex("attendance")
        .where({ id: insertedAttendanceId, company_id: companyId })
        .first();
    }

    const isAutoApproved = hasAnyRole(req.user, ["admin", "ceo", "superadmin"]);
    const insertedOverride = await knex("attendance_overrides").insert({
      company_id: companyId,
      attendance_id: attendance.id,
      employee_id: attendance.employee_id,
      original_status: originalStatus || attendance.status,
      overridden_status: overriddenStatus || attendance.status,
      reason,
      requested_check_in: normalizedRequestedCheckIn,
      requested_check_out: normalizedRequestedCheckOut,
      requested_by: userId,
      approved_by: isAutoApproved ? userId : null,
      status: isAutoApproved ? "approved" : "pending",
    });

    const insertedOverrideRaw = Array.isArray(insertedOverride)
      ? insertedOverride[0]
      : insertedOverride;
    const insertedOverrideId =
      typeof insertedOverrideRaw === "object"
        ? insertedOverrideRaw.id
        : insertedOverrideRaw;
    const override = await knex("attendance_overrides")
      .where({ id: insertedOverrideId, company_id: companyId })
      .first();

    // If admin approved immediately
    if (override && override.status === "approved") {
      const attendanceDate = getAttendanceDate(attendance, date);
      const updatePayload = buildAttendanceOverrideUpdate({
        override,
        date: attendanceDate,
      });

      await knex("attendance").where("id", attendance.id).update(updatePayload);
    }

    // await logAudit('create_override', 'attendance_overrides', override.id, userId, {
    //   attendance_id: attendanceId,
    //   status: override.status
    // });

    res.status(201).json({
      success: true,
      override,
    });
  } catch (error) {
    console.error("Create override error:", error);
    res.status(500).json({ message: "Error creating attendance override" });
  }
};

// Process override (approve/reject) - company scoped
const processOverride = async (req, res) => {
  const companyId = req.user.company_id;
  if (!companyId) {
    return res.status(400).json({ message: "Company not assigned to user" });
  }

  const { overrideId } = req.params;
  const { status } = req.body;
  const comment = req.body.comment ?? req.body.remarks ?? null;
  const userId = req.user.id;

  try {
    // Business rule: only admin/ceo/superadmin can approve or reject overrides.
    if (!hasAnyRole(req.user, ["admin", "ceo", "superadmin"])) {
      return res
        .status(403)
        .json({ message: "Not authorized to process overrides" });
    }

    if (
      !["approved", "rejected"].includes(String(status || "").toLowerCase())
    ) {
      return res
        .status(400)
        .json({ message: "Invalid status. Expected approved or rejected" });
    }

    const override = await knex("attendance_overrides")
      .where({ id: overrideId, company_id: companyId })
      .first();

    if (!override) {
      return res
        .status(404)
        .json({ message: "Override not found or access denied" });
    }

    if (String(override.status || "").toLowerCase() !== "pending") {
      return res
        .status(400)
        .json({ message: "Only pending overrides can be processed" });
    }

    await knex("attendance_overrides").where("id", overrideId).update({
      status,
      approved_by: userId,
      reviewed_at: new Date(),
      comment,
    });

    const updatedOverride = await knex("attendance_overrides")
      .where({ id: overrideId, company_id: companyId })
      .first();

    if (status === "approved") {
      const attendance = await knex("attendance")
        .where({ id: override.attendance_id, company_id: companyId })
        .select(
          "*",
          knex.raw("DATE_FORMAT(check_in, '%Y-%m-%d') as attendance_date"),
        )
        .first();

      if (!attendance) {
        return res
          .status(404)
          .json({ message: "Attendance record not found for this override" });
      }

      const attendanceDate = getAttendanceDate(attendance);
      const updatePayload = buildAttendanceOverrideUpdate({
        override,
        date: attendanceDate,
      });

      await knex("attendance")
        .where("id", override.attendance_id)
        .update(updatePayload);
    }

    // await logAudit(`override_${status}`, 'attendance_overrides', overrideId, userId, { status, comment });

    res.json({
      success: true,
      override: updatedOverride,
    });
  } catch (error) {
    console.error("Process override error:", error);
    res.status(500).json({ message: "Error processing override" });
  }
};

// Get employee attendance summary (company scoped)
const getEmployeeSummary = async (req, res) => {
  const companyId = req.user.company_id;
  if (!companyId) {
    return res.status(400).json({ message: "Company not assigned to user" });
  }

  const { employeeId } = req.params;
  const { startDate, endDate } = req.query;

  // 🔒 Employee access control
  if (
    hasAnyRole(req.user, ["employee"]) &&
    !hasAnyRole(req.user, ["manager", "hr", "admin", "ceo", "superadmin"]) &&
    employeeId != req.user.id
  ) {
    return res.status(403).json({ message: "Access denied" });
  }

  try {
    // Verify employee belongs to company
    const employee = await knex("employees")
      .where({ id: employeeId, company_id: companyId })
      .first();

    if (!employee) {
      return res
        .status(404)
        .json({ message: "Employee not found or access denied" });
    }

    let query = knex("attendance").where({
      employee_id: employeeId,
      company_id: companyId,
    });

    if (startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      query = query.whereBetween("check_in", [start, end]);
    }

    const records = await query.orderBy("check_in", "desc");

    const summary = {
      total_days: records.length,
      present_days: records.filter((r) => r.status === "present").length,
      half_days: records.filter((r) => r.status === "half").length,
      absent_days: records.filter((r) => r.status === "absent").length,
      total_hours: records.reduce((sum, r) => sum + (r.hours_worked || 0), 0),
      total_overtime: records.reduce(
        (sum, r) => sum + (r.overtime_hours || 0),
        0,
      ),
      average_hours_per_day:
        records.length > 0
          ? records.reduce((sum, r) => sum + (r.hours_worked || 0), 0) /
            records.length
          : 0,
      recent_records: records.slice(0, 5),
    };

    res.json({
      success: true,
      summary,
    });
  } catch (error) {
    console.error("Get employee summary error:", error);
    res.status(500).json({ message: "Error generating attendance summary" });
  }
};

const getOverrides = async (req, res) => {
  const companyId = req.user.company_id;
  const { employeeId } = req.query; // optional filter by employee

  if (!companyId) {
    return res.status(400).json({ message: "Company not assigned to user" });
  }

  try {
    const canViewAllOverrides = hasAnyRole(req.user, [
      "manager",
      "hr",
      "admin",
      "ceo",
      "superadmin",
    ]);
    const viewerEmployeeId = canViewAllOverrides
      ? null
      : await resolveAttendanceEmployeeId(req);

    // Step 1: Get overrides
    let query = knex("attendance_overrides")
      .where({ company_id: companyId })
      .orderBy("created_at", "desc");

    if (canViewAllOverrides) {
      if (employeeId) {
        query = query.andWhere({ employee_id: employeeId });
      }
    } else {
      // Employee-level users can see only their own override requests.
      query = query.andWhere({ employee_id: viewerEmployeeId });
    }

    const overrides = await query.select(
      "id",
      "attendance_id",
      "employee_id",
      "original_status",
      "overridden_status",
      "reason",
      "requested_check_in",
      "requested_check_out",
      "requested_by",
      "approved_by",
      "status",
      "created_at",
      "updated_at",
    );

    if (!overrides.length) {
      return res.status(404).json({ message: "No overrides found" });
    }

    // Step 2: Get employee codes for all employee_ids in overrides
    const employeeIds = overrides.map((o) => o.employee_id);
    const employees = await knex("employees")
      .whereIn("id", employeeIds)
      .select("id", "employee_id");

    const employeeMap = {};
    employees.forEach((emp) => {
      employeeMap[emp.id] = emp.employee_id;
    });

    // Step 3: Resolve override date from attendance record
    const attendanceIds = overrides.map((o) => o.attendance_id).filter(Boolean);
    const attendanceRecords = attendanceIds.length
      ? await knex("attendance")
          .where({ company_id: companyId })
          .whereIn("id", attendanceIds)
          .select(
            "id",
            knex.raw("DATE_FORMAT(check_in, '%Y-%m-%d') as attendance_date"),
          )
      : [];

    const attendanceDateMap = {};
    attendanceRecords.forEach((record) => {
      attendanceDateMap[record.id] = record.attendance_date || null;
    });

    // Step 4: Resolve requester/approver names (employees first, users fallback)
    const actorIds = [
      ...new Set(
        overrides
          .flatMap((o) => [o.requested_by, o.approved_by])
          .filter((id) => id !== null && id !== undefined),
      ),
    ];

    const actorEmployeeRows = actorIds.length
      ? await knex("employees")
          .where({ company_id: companyId })
          .whereIn("id", actorIds)
          .select("id", "first_name", "last_name")
      : [];

    const actorUserRows = actorIds.length
      ? await knex("users").whereIn("id", actorIds).select("id", "name")
      : [];

    const actorEmployeeNameMap = {};
    actorEmployeeRows.forEach((row) => {
      actorEmployeeNameMap[row.id] =
        `${row.first_name || ""} ${row.last_name || ""}`.trim();
    });

    const actorUserNameMap = {};
    actorUserRows.forEach((row) => {
      actorUserNameMap[row.id] = row.name || null;
    });

    const resolveActorName = (actorId) => {
      if (!actorId) return null;
      return actorEmployeeNameMap[actorId] || actorUserNameMap[actorId] || null;
    };

    // Step 5: Attach employee code + override date + actor names
    const overridesWithCode = overrides.map((o) => ({
      ...o,
      employee_id: employeeMap[o.employee_id] || null,
      override_date: attendanceDateMap[o.attendance_id] || null,
      requested_by_name: resolveActorName(o.requested_by),
      approved_by_name: resolveActorName(o.approved_by),
    }));

    res.status(200).json({ success: true, overrides: overridesWithCode });
  } catch (error) {
    console.error("Get overrides error:", error);
    res.status(500).json({ message: "Error fetching attendance overrides" });
  }
};

const postLiveLocation = async (req, res) => {
  try {
    const companyId = Number(req.user?.company_id);
    const employeeId = await resolveAttendanceEmployeeId(req);
    const latitude = Number(req.body?.latitude);
    const longitude = Number(req.body?.longitude);
    const accuracy =
      req.body?.accuracy != null ? Number(req.body.accuracy) : null;

    if (!companyId || !employeeId) {
      return res.status(400).json({
        success: false,
        message: "Missing employee or company context",
      });
    }

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return res.status(400).json({
        success: false,
        message: "Valid latitude and longitude are required",
      });
    }

    const timestampValue = req.body?.timestamp
      ? new Date(req.body.timestamp)
      : new Date();
    let locationTimestamp = Number.isNaN(timestampValue.getTime())
      ? new Date()
      : timestampValue;

    const buildInsertPayload = (timestamp) => ({
      employee_id: employeeId,
      company_id: companyId,
      latitude,
      longitude,
      accuracy: Number.isFinite(accuracy) ? accuracy : null,
      address: req.body?.address || null,
      location_data: JSON.stringify({
        timestamp: timestamp.toISOString(),
        source: req.body?.source || "web",
      }),
      is_tracking: true,
      tracking_status: "active",
      device_info: req.body?.device_info || req.body?.deviceInfo || "web",
      session_id: req.body?.session_id || null,
      location_timestamp: timestamp,
      last_updated: knex.fn.now(),
    });

    let inserted = null;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      try {
        inserted = await knex("employee_live_locations").insert(
          buildInsertPayload(locationTimestamp),
        );
        break;
      } catch (insertError) {
        const isDuplicateTimestamp =
          insertError?.code === "ER_DUP_ENTRY" || insertError?.errno === 1062;

        if (!isDuplicateTimestamp || attempt === 9) {
          throw insertError;
        }

        locationTimestamp = new Date(locationTimestamp.getTime() + 1000);
      }
    }

    const insertedRaw = Array.isArray(inserted) ? inserted[0] : inserted;
    const insertedId =
      typeof insertedRaw === "object" ? insertedRaw.id : insertedRaw;

    const location = await knex("employee_live_locations")
      .where({ id: insertedId, company_id: companyId })
      .first();

    if (location) {
      const employee = await knex("employees")
        .where({ id: employeeId, company_id: companyId })
        .first("first_name", "last_name", "employee_id");

      const io = getIo();
      if (io) {
        io.to(`company:${companyId}`).emit("location:update", {
          ...location,
          employeeName: employee
            ? `${employee.first_name || ""} ${employee.last_name || ""}`.trim()
            : undefined,
          employee_code: employee?.employee_id || null,
          tracking_status: "active",
          minutes_since_update: 0,
        });
      }
    }

    return res.status(201).json({
      success: true,
      message: "Live location saved",
      location,
    });
  } catch (error) {
    console.error("Post live location error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to save live location",
    });
  }
};

const getLiveLocations = async (req, res) => {
  try {
    const companyId = Number(req.user?.company_id);
    if (!companyId) {
      return res
        .status(400)
        .json({ success: false, message: "Company not assigned to user" });
    }

    const latestLocationSubquery = knex("employee_live_locations as ell")
      .select("ell.employee_id")
      .max("ell.location_timestamp as latest_timestamp")
      .where("ell.company_id", companyId)
      .groupBy("ell.employee_id")
      .as("latest_locations");

    const locations = await knex("employee_live_locations as ell")
      .join(latestLocationSubquery, function () {
        this.on("ell.employee_id", "=", "latest_locations.employee_id").andOn(
          "ell.location_timestamp",
          "=",
          "latest_locations.latest_timestamp",
        );
      })
      .leftJoin("employees as e", "ell.employee_id", "e.id")
      .where("ell.company_id", companyId)
      .select(
        "ell.id",
        "ell.employee_id",
        "ell.latitude",
        "ell.longitude",
        "ell.accuracy",
        "ell.address",
        "ell.location_timestamp",
        "ell.last_updated",
        "ell.device_info",
        "ell.tracking_status",
        "ell.is_tracking",
        "e.first_name",
        "e.last_name",
        "e.employee_id as employee_code",
      )
      .orderBy("ell.location_timestamp", "desc");

    const { start: todayStart, end: tomorrowStart } = getDayWindow();
    const todayDate = formatDateOnly(todayStart);
    const tomorrowDate = formatDateOnly(tomorrowStart);

    const activeRegularRows = await knex("attendance")
      .where({ company_id: companyId })
      .where("check_in", ">=", todayStart)
      .where("check_in", "<", tomorrowStart)
      .whereNull("check_out")
      .select("employee_id");

    const activeFieldRows = await knex("client_attendance as ca")
      .leftJoin("employees as e", "ca.employee_id", "e.id")
      .where("e.company_id", companyId)
      .where("ca.date", ">=", todayDate)
      .where("ca.date", "<", tomorrowDate)
      .whereNull("ca.check_out_time")
      .select("ca.employee_id", "ca.id as field_attendance_id", "ca.client_id");

    const activeRegularEmployeeIds = new Set(
      activeRegularRows.map((row) => Number(row.employee_id)),
    );
    const activeFieldAttendanceByEmployee = new Map(
      activeFieldRows.map((row) => [
        Number(row.employee_id),
        {
          field_attendance_id: row.field_attendance_id,
          client_id: row.client_id,
        },
      ]),
    );

    const now = Date.now();
    const enrichedLocations = locations.map((location) => {
      const employeeId = Number(location.employee_id);
      const hasActiveRegularAttendance =
        activeRegularEmployeeIds.has(employeeId);
      const activeFieldAttendance =
        activeFieldAttendanceByEmployee.get(employeeId) || null;
      const hasActiveFieldAttendance = Boolean(activeFieldAttendance);
      const timestamp = location.location_timestamp
        ? new Date(location.location_timestamp)
        : null;
      const minutesSinceUpdate =
        timestamp && !Number.isNaN(timestamp.getTime())
          ? Math.max(0, Math.round((now - timestamp.getTime()) / 60000))
          : null;

      let computedTrackingStatus =
        String(location.tracking_status || "").toLowerCase() || "offline";
      if (!hasActiveRegularAttendance && !hasActiveFieldAttendance) {
        computedTrackingStatus = "offline";
      } else if (minutesSinceUpdate !== null) {
        if (minutesSinceUpdate <= 5) {
          computedTrackingStatus = "active";
        } else if (minutesSinceUpdate <= 15) {
          computedTrackingStatus = "idle";
        } else {
          computedTrackingStatus = "offline";
        }
      }

      return {
        ...location,
        tracking_status: computedTrackingStatus,
        minutes_since_update: minutesSinceUpdate,
        has_active_attendance: hasActiveRegularAttendance,
        has_active_field_attendance: hasActiveFieldAttendance,
        active_session_type: hasActiveFieldAttendance
          ? "field_attendance"
          : hasActiveRegularAttendance
            ? "attendance"
            : null,
        field_attendance_id: activeFieldAttendance?.field_attendance_id || null,
        client_id: activeFieldAttendance?.client_id || null,
      };
    });

    return res.json({
      success: true,
      locations: enrichedLocations,
    });
  } catch (error) {
    console.error("Get live locations error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch live locations",
    });
  }
};

const getLiveLocationHistory = async (req, res) => {
  try {
    const companyId = Number(req.user?.company_id);
    const requestedEmployeeId = Number(req.params?.employeeId);

    if (!companyId) {
      return res
        .status(400)
        .json({ success: false, message: "Company not assigned to user" });
    }

    if (!Number.isFinite(requestedEmployeeId)) {
      return res
        .status(400)
        .json({ success: false, message: "Valid employee id is required" });
    }

    let loggedInUser = null;
    const hasCompanyWideAccess = hasAnyRole(req.user, [
      "admin",
      "hr",
      "finance",
      "ceo",
      "superadmin",
    ]);

    if (!hasCompanyWideAccess) {
      loggedInUser = await knex("employees")
        .where({ id: req.user.id, company_id: companyId })
        .first();

      if (!loggedInUser) {
        return res
          .status(403)
          .json({ success: false, message: "User not found" });
      }

      if (hasAnyRole(loggedInUser, ["manager"])) {
        const requestedEmployee = await knex("employees")
          .where({ id: requestedEmployeeId, company_id: companyId })
          .first();

        if (!requestedEmployee) {
          return res
            .status(404)
            .json({ success: false, message: "Employee not found" });
        }

        if (
          requestedEmployee.id !== loggedInUser.id &&
          requestedEmployee.department_id !== loggedInUser.department_id
        ) {
          return res.status(403).json({
            success: false,
            message: "Not allowed to view this employee history",
          });
        }
      } else if (requestedEmployeeId !== loggedInUser.id) {
        return res.status(403).json({
          success: false,
          message: "Not allowed to view this employee history",
        });
      }
    }

    const {
      startDate,
      endDate,
      sessionId,
      limit = 500,
      stayRadiusMeters = 60,
      minimumStayMinutes = 5,
    } = req.query;

    const employee = await knex("employees")
      .where({ id: requestedEmployeeId, company_id: companyId })
      .first("id", "first_name", "last_name", "employee_id");

    if (!employee) {
      return res
        .status(404)
        .json({ success: false, message: "Employee not found" });
    }

    let historyQuery = knex("employee_live_locations as ell").where({
      "ell.company_id": companyId,
      "ell.employee_id": requestedEmployeeId,
    });

    if (startDate) {
      historyQuery = historyQuery.where(
        "ell.location_timestamp",
        ">=",
        new Date(startDate),
      );
    }

    if (endDate) {
      historyQuery = historyQuery.where(
        "ell.location_timestamp",
        "<=",
        new Date(endDate),
      );
    }

    if (sessionId) {
      historyQuery = historyQuery.where("ell.session_id", String(sessionId));
    }

    const pointLimit = Math.min(Math.max(Number(limit) || 500, 1), 2000);

    const points = await historyQuery
      .clone()
      .select(
        "ell.id",
        "ell.employee_id",
        "ell.latitude",
        "ell.longitude",
        "ell.accuracy",
        "ell.address",
        "ell.location_timestamp",
        "ell.device_info",
        "ell.session_id",
        "ell.tracking_status",
        "ell.is_tracking",
      )
      .orderBy("ell.location_timestamp", "asc")
      .limit(pointLimit);

    // Group points by coordinates to avoid redundant geocoding API calls
    const coordinateMap = new Map();
    const pointsNeedingGeocode = [];

    points.forEach((point) => {
      if (point.address) {
        // Already has address, no need to geocode
        return;
      }
      const coordKey = `${Number(point.latitude).toFixed(6)},${Number(point.longitude).toFixed(6)}`;
      if (!coordinateMap.has(coordKey)) {
        coordinateMap.set(coordKey, []);
        pointsNeedingGeocode.push(point);
      }
      coordinateMap.get(coordKey).push(point);
    });

    // Geocode only unique coordinates (with batch processing to avoid rate limiting)
    const geocodedAddresses = new Map();
    const batchSize = 5; // Process 5 at a time with small delay

    for (let i = 0; i < pointsNeedingGeocode.length; i += batchSize) {
      const batch = pointsNeedingGeocode.slice(i, i + batchSize);
      await Promise.all(
        batch.map(async (point) => {
          const coordKey = `${Number(point.latitude).toFixed(6)},${Number(point.longitude).toFixed(6)}`;
          try {
            const reverseGeocoded = await reverseGeocodeForLiveTracking({
              latitude: Number(point.latitude),
              longitude: Number(point.longitude),
            });
            geocodedAddresses.set(coordKey, reverseGeocoded?.address || null);
          } catch (error) {
            console.warn("Reverse geocoding failed for point:", point.id);
            geocodedAddresses.set(coordKey, null);
          }
        }),
      );
      // Small delay between batches to avoid rate limiting
      if (i + batchSize < pointsNeedingGeocode.length) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    // Apply geocoded addresses to all points
    const finalPoints = points.map((point) => {
      if (point.address) return point;
      const coordKey = `${Number(point.latitude).toFixed(6)},${Number(point.longitude).toFixed(6)}`;
      const address = geocodedAddresses.get(coordKey);
      return { ...point, address: address || null };
    });

    const attendanceRecord = await knex("attendance as a")
      .where({
        "a.company_id": companyId,
        "a.employee_id": requestedEmployeeId,
      })
      .modify((qb) => {
        if (startDate) qb.where("a.check_in", ">=", new Date(startDate));
        if (endDate) qb.where("a.check_in", "<=", new Date(endDate));
      })
      .orderBy("a.check_in", "desc")
      .first(
        "a.id",
        "a.check_in",
        "a.check_out",
        "a.check_in_location",
        "a.check_out_location",
        "a.hours_worked",
        "a.status",
      );

    const fieldAttendanceRecord = await knex("client_attendance as ca")
      .leftJoin("employees as e", "ca.employee_id", "e.id")
      .leftJoin("clients as c", "ca.client_id", "c.id")
      .where({
        "e.company_id": companyId,
        "ca.employee_id": requestedEmployeeId,
      })
      .modify((qb) => {
        if (startDate) qb.where("ca.check_in_time", ">=", new Date(startDate));
        if (endDate) qb.where("ca.check_in_time", "<=", new Date(endDate));
      })
      .orderBy("ca.check_in_time", "desc")
      .first(
        "ca.id",
        "ca.client_id",
        "c.client_name",
        "ca.check_in_time",
        "ca.check_out_time",
        "ca.check_in_latitude",
        "ca.check_in_longitude",
        "ca.check_in_location",
        "ca.check_out_latitude",
        "ca.check_out_longitude",
        "ca.check_out_location",
        "ca.duration_minutes",
      );

    const parseStoredLocation = (rawValue) => {
      if (!rawValue) return null;
      if (typeof rawValue === "string") {
        try {
          return JSON.parse(rawValue);
        } catch {
          return null;
        }
      }
      return rawValue;
    };

    const formatCoordinateLabel = (latitude, longitude) => {
      const lat = Number(latitude);
      const lng = Number(longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
    };

    const parsedCheckInLocation = parseStoredLocation(
      attendanceRecord?.check_in_location,
    );
    const parsedCheckOutLocation = parseStoredLocation(
      attendanceRecord?.check_out_location,
    );

    const haversineMeters = (lat1, lon1, lat2, lon2) => {
      const toRad = (deg) => (deg * Math.PI) / 180;
      const R = 6371000;
      const dLat = toRad(lat2 - lat1);
      const dLon = toRad(lon2 - lon1);
      const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRad(lat1)) *
          Math.cos(toRad(lat2)) *
          Math.sin(dLon / 2) *
          Math.sin(dLon / 2);
      return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    };

    let totalDistanceMeters = 0;
    for (let i = 1; i < finalPoints.length; i += 1) {
      const prev = finalPoints[i - 1];
      const current = finalPoints[i];
      const prevLat = Number(prev.latitude);
      const prevLng = Number(prev.longitude);
      const currentLat = Number(current.latitude);
      const currentLng = Number(current.longitude);

      if (
        Number.isFinite(prevLat) &&
        Number.isFinite(prevLng) &&
        Number.isFinite(currentLat) &&
        Number.isFinite(currentLng)
      ) {
        totalDistanceMeters += haversineMeters(
          prevLat,
          prevLng,
          currentLat,
          currentLng,
        );
      }
    }

    const startPoint = finalPoints[0] || null;
    const endPoint = finalPoints[finalPoints.length - 1] || null;
    const tripDurationMinutes =
      startPoint && endPoint
        ? Math.max(
            0,
            Math.round(
              (new Date(endPoint.location_timestamp).getTime() -
                new Date(startPoint.location_timestamp).getTime()) /
                60000,
            ),
          )
        : 0;

    const normalizedStayRadiusMeters = Math.min(
      Math.max(Number(stayRadiusMeters) || 60, 20),
      250,
    );
    const normalizedMinimumStayMinutes = Math.min(
      Math.max(Number(minimumStayMinutes) || 5, 1),
      240,
    );

    const buildStaySegments = (routePoints) => {
      if (!Array.isArray(routePoints) || routePoints.length === 0) {
        return [];
      }

      const segments = [];
      let currentSegment = {
        points: [routePoints[0]],
        anchor: routePoints[0],
      };

      const flushSegment = () => {
        const segmentPoints = currentSegment.points;
        const firstPoint = segmentPoints[0];
        const lastPoint = segmentPoints[segmentPoints.length - 1];
        const startedAt = firstPoint?.location_timestamp
          ? new Date(firstPoint.location_timestamp)
          : null;
        const endedAt = lastPoint?.location_timestamp
          ? new Date(lastPoint.location_timestamp)
          : null;

        if (!startedAt || !endedAt) {
          return;
        }

        const durationMinutes = Math.max(
          0,
          Math.round((endedAt.getTime() - startedAt.getTime()) / 60000),
        );

        if (durationMinutes < normalizedMinimumStayMinutes) {
          return;
        }

        const avgLatitude =
          segmentPoints.reduce(
            (sum, point) => sum + Number(point.latitude || 0),
            0,
          ) / segmentPoints.length;
        const avgLongitude =
          segmentPoints.reduce(
            (sum, point) => sum + Number(point.longitude || 0),
            0,
          ) / segmentPoints.length;

        segments.push({
          startTime: firstPoint.location_timestamp || null,
          endTime: lastPoint.location_timestamp || null,
          durationMinutes,
          latitude: Number(avgLatitude.toFixed(6)),
          longitude: Number(avgLongitude.toFixed(6)),
          address:
            segmentPoints
              .map((point) => String(point.address || "").trim())
              .find(Boolean) ||
            formatCoordinateLabel(avgLatitude, avgLongitude),
          pointCount: segmentPoints.length,
        });
      };

      for (let index = 1; index < routePoints.length; index += 1) {
        const point = routePoints[index];
        const distanceFromAnchor = haversineMeters(
          Number(currentSegment.anchor.latitude),
          Number(currentSegment.anchor.longitude),
          Number(point.latitude),
          Number(point.longitude),
        );

        if (distanceFromAnchor <= normalizedStayRadiusMeters) {
          currentSegment.points.push(point);
          continue;
        }

        flushSegment();
        currentSegment = {
          points: [point],
          anchor: point,
        };
      }

      flushSegment();
      return segments;
    };

    const staySegments = buildStaySegments(finalPoints);
    const currentStay = staySegments.length
      ? staySegments[staySegments.length - 1]
      : null;
    const lastSeenAt = endPoint?.location_timestamp || null;
    const minutesSinceLastPing =
      lastSeenAt && !Number.isNaN(new Date(lastSeenAt).getTime())
        ? Math.max(
            0,
            Math.round((Date.now() - new Date(lastSeenAt).getTime()) / 60000),
          )
        : null;

    return res.json({
      success: true,
      employee,
      points: finalPoints,
      summary: {
        pointCount: finalPoints.length,
        totalDistanceMeters: Number(totalDistanceMeters.toFixed(2)),
        tripDurationMinutes,
        startedAt:
          startPoint?.location_timestamp ||
          attendanceRecord?.check_in ||
          fieldAttendanceRecord?.check_in_time ||
          null,
        endedAt:
          endPoint?.location_timestamp ||
          attendanceRecord?.check_out ||
          fieldAttendanceRecord?.check_out_time ||
          null,
        stopCount: staySegments.length,
        stayRadiusMeters: normalizedStayRadiusMeters,
        minimumStayMinutes: normalizedMinimumStayMinutes,
        stops: staySegments,
        currentStay: currentStay || null,
        lastSeenAt,
        minutesSinceLastPing,
        startAddress:
          startPoint?.address ||
          parsedCheckInLocation?.address ||
          formatCoordinateLabel(
            parsedCheckInLocation?.latitude,
            parsedCheckInLocation?.longitude,
          ) ||
          fieldAttendanceRecord?.check_in_location ||
          formatCoordinateLabel(
            fieldAttendanceRecord?.check_in_latitude,
            fieldAttendanceRecord?.check_in_longitude,
          ) ||
          null,
        endAddress:
          endPoint?.address ||
          parsedCheckOutLocation?.address ||
          formatCoordinateLabel(endPoint?.latitude, endPoint?.longitude) ||
          fieldAttendanceRecord?.check_out_location ||
          formatCoordinateLabel(
            fieldAttendanceRecord?.check_out_latitude,
            fieldAttendanceRecord?.check_out_longitude,
          ) ||
          parsedCheckInLocation?.address ||
          formatCoordinateLabel(
            parsedCheckInLocation?.latitude,
            parsedCheckInLocation?.longitude,
          ) ||
          formatCoordinateLabel(
            parsedCheckOutLocation?.latitude,
            parsedCheckOutLocation?.longitude,
          ) ||
          null,
        attendance: attendanceRecord || null,
        fieldAttendance: fieldAttendanceRecord || null,
      },
    });
  } catch (error) {
    console.error("Get live location history error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch live location history",
    });
  }
};

const exportLocationHistory = async (req, res) => {
  try {
    const companyId = Number(req.user?.company_id);
    const rawEmployeeId = String(req.params?.employeeId || "").trim();
    const isAllEmployeesExport = rawEmployeeId.toLowerCase() === "all";
    const requestedEmployeeId = Number(rawEmployeeId);
    const { startDate, endDate, format = "csv" } = req.query;

    if (!companyId) {
      return res
        .status(400)
        .json({ success: false, message: "Company not assigned to user" });
    }

    if (!isAllEmployeesExport && !Number.isFinite(requestedEmployeeId)) {
      return res
        .status(400)
        .json({ success: false, message: "Valid employee id is required" });
    }

    // Permission checks
    let loggedInUser = null;
    const hasCompanyWideAccess = hasAnyRole(req.user, [
      "admin",
      "hr",
      "finance",
      "ceo",
      "superadmin",
    ]);

    if (!hasCompanyWideAccess) {
      loggedInUser = await knex("employees")
        .where({ id: req.user.id, company_id: companyId })
        .first();

      if (!loggedInUser) {
        return res
          .status(403)
          .json({ success: false, message: "User not found" });
      }

      if (hasAnyRole(loggedInUser, ["manager"])) {
        if (isAllEmployeesExport) {
          loggedInUser.exportDepartmentOnly = true;
        }

        const requestedEmployee = isAllEmployeesExport
          ? null
          : await knex("employees")
              .where({ id: requestedEmployeeId, company_id: companyId })
              .first();

        if (!isAllEmployeesExport && !requestedEmployee) {
          return res
            .status(404)
            .json({ success: false, message: "Employee not found" });
        }

        if (
          !isAllEmployeesExport &&
          requestedEmployee.id !== loggedInUser.id &&
          requestedEmployee.department_id !== loggedInUser.department_id
        ) {
          return res.status(403).json({
            success: false,
            message: "Not allowed to view this employee history",
          });
        }
      } else if (isAllEmployeesExport || requestedEmployeeId !== loggedInUser.id) {
        return res.status(403).json({
          success: false,
          message: "Not allowed to view this employee history",
        });
      }
    }

    if (isAllEmployeesExport) {
      let historyQuery = knex("employee_live_locations as ell")
        .leftJoin("employees as e", "ell.employee_id", "e.id")
        .leftJoin("departments as d", "e.department_id", "d.id")
        .where("ell.company_id", companyId)
        .where("e.company_id", companyId);

      if (loggedInUser?.exportDepartmentOnly) {
        historyQuery = historyQuery.where(
          "e.department_id",
          loggedInUser.department_id,
        );
      }

      if (startDate) {
        historyQuery = historyQuery.where(
          "ell.location_timestamp",
          ">=",
          new Date(startDate),
        );
      }

      if (endDate) {
        historyQuery = historyQuery.where(
          "ell.location_timestamp",
          "<=",
          new Date(endDate),
        );
      }

      const points = await historyQuery
        .select(
          "ell.latitude",
          "ell.longitude",
          "ell.accuracy",
          "ell.address",
          "ell.location_timestamp",
          "ell.device_info",
          "e.employee_id",
          "e.first_name",
          "e.last_name",
          "e.email",
          "d.name as department_name",
        )
        .orderBy("ell.location_timestamp", "asc")
        .limit(20000);

      if (format === "csv") {
        let csv =
          "Employee ID,Employee Name,Email,Department,Date,Time,Location Address,Accuracy,Latitude,Longitude,Device Info\n";

        points.forEach((point) => {
          const date = new Date(point.location_timestamp);
          const day = String(date.getDate()).padStart(2, "0");
          const month = String(date.getMonth() + 1).padStart(2, "0");
          const year = date.getFullYear();
          const dateStr = `${day}/${month}/${year}`;
          const timeStr = date.toLocaleTimeString("en-IN", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false,
          });
          const latitude = Number(point.latitude).toFixed(6);
          const longitude = Number(point.longitude).toFixed(6);
          const accuracy = point.accuracy
            ? Number(point.accuracy).toFixed(2)
            : "N/A";
          const address = (point.address || "").replace(/"/g, '""');
          const deviceInfo = (point.device_info || "").replace(/"/g, '""');
          const employeeName = `${point.first_name || ""} ${point.last_name || ""}`.trim();

          csv += `"${point.employee_id || ""}","${employeeName}","${point.email || ""}","${point.department_name || ""}","'${dateStr}","${timeStr}","${address}",${accuracy},${latitude},${longitude},"${deviceInfo}"\n`;
        });

        csv += "\n\nSummary:\n";
        csv += `Total Points,${points.length}\n`;

        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader(
          "Content-Disposition",
          `attachment;filename="all_employees_location_history_${new Date().toISOString().split("T")[0]}.csv"`,
        );
        return res.send(csv);
      } else if (format === "json") {
        return res.json({
          success: true,
          locations: points,
          summary: {
            totalPoints: points.length,
            startDate: startDate || null,
            endDate: endDate || null,
          },
        });
      }

      return res
        .status(400)
        .json({ success: false, message: "Invalid format. Use csv or json." });
    }

    // Get employee info
    const employee = await knex("employees")
      .where({ id: requestedEmployeeId, company_id: companyId })
      .first(
        "id",
        "first_name",
        "last_name",
        "employee_id",
        "email",
        "department_id",
      );

    if (!employee) {
      return res
        .status(404)
        .json({ success: false, message: "Employee not found" });
    }

    // Build query for location history
    let historyQuery = knex("employee_live_locations as ell").where({
      "ell.company_id": companyId,
      "ell.employee_id": requestedEmployeeId,
    });

    if (startDate) {
      historyQuery = historyQuery.where(
        "ell.location_timestamp",
        ">=",
        new Date(startDate),
      );
    }

    if (endDate) {
      historyQuery = historyQuery.where(
        "ell.location_timestamp",
        "<=",
        new Date(endDate),
      );
    }

    const points = await historyQuery
      .select(
        "ell.id",
        "ell.latitude",
        "ell.longitude",
        "ell.accuracy",
        "ell.address",
        "ell.location_timestamp",
        "ell.device_info",
      )
      .orderBy("ell.location_timestamp", "asc")
      .limit(5000);

    // Geocode points that don't have addresses
    const coordinateMap = new Map();
    const pointsNeedingGeocode = [];

    points.forEach((point) => {
      if (point.address) {
        return;
      }
      const coordKey = `${Number(point.latitude).toFixed(6)},${Number(point.longitude).toFixed(6)}`;
      if (!coordinateMap.has(coordKey)) {
        coordinateMap.set(coordKey, []);
        pointsNeedingGeocode.push(point);
      }
      coordinateMap.get(coordKey).push(point);
    });

    // Geocode only unique coordinates (with batch processing to avoid rate limiting)
    const geocodedAddresses = new Map();
    const batchSize = 5;

    for (let i = 0; i < pointsNeedingGeocode.length; i += batchSize) {
      const batch = pointsNeedingGeocode.slice(i, i + batchSize);
      await Promise.all(
        batch.map(async (point) => {
          const coordKey = `${Number(point.latitude).toFixed(6)},${Number(point.longitude).toFixed(6)}`;
          try {
            const reverseGeocoded = await reverseGeocodeForLiveTracking({
              latitude: Number(point.latitude),
              longitude: Number(point.longitude),
            });
            geocodedAddresses.set(coordKey, reverseGeocoded?.address || null);
          } catch (error) {
            console.warn("Reverse geocoding failed for point:", point.id);
            geocodedAddresses.set(coordKey, null);
          }
        }),
      );
      if (i + batchSize < pointsNeedingGeocode.length) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    // Apply geocoded addresses to all points
    const finalPoints = points.map((point) => {
      if (point.address) return point;
      const coordKey = `${Number(point.latitude).toFixed(6)},${Number(point.longitude).toFixed(6)}`;
      const address = geocodedAddresses.get(coordKey);
      return { ...point, address: address || null };
    });

    // Get attendance for context
    let attendanceQuery = knex("attendance as a").where({
      "a.company_id": companyId,
      "a.employee_id": requestedEmployeeId,
    });

    if (startDate) {
      attendanceQuery = attendanceQuery.where(
        "a.check_in",
        ">=",
        new Date(startDate),
      );
    }

    if (endDate) {
      attendanceQuery = attendanceQuery.where(
        "a.check_in",
        "<=",
        new Date(endDate),
      );
    }

    const attendance = await attendanceQuery
      .select(
        "a.check_in",
        "a.check_out",
        "a.check_in_location",
        "a.check_out_location",
      )
      .orderBy("a.check_in", "desc")
      .first();

    if (format === "csv") {
      // Generate CSV
      let csv =
        "Employee ID,Employee Name,Email,Department,Date,Time,Location Address,Accuracy,Latitude,Longitude,Device Info\n";

      finalPoints.forEach((point) => {
        const date = new Date(point.location_timestamp);
        // Ultra-compact date format (DD/MM/YYYY) - exactly 10 chars to avoid "######" in sheets
        const day = String(date.getDate()).padStart(2, "0");
        const month = String(date.getMonth() + 1).padStart(2, "0");
        const year = date.getFullYear();
        const dateStr = `${day}/${month}/${year}`;

        // Compact time format (HH:MM:SS) for better spreadsheet compatibility
        const timeStr = date.toLocaleTimeString("en-IN", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false,
        });
        const latitude = Number(point.latitude).toFixed(6);
        const longitude = Number(point.longitude).toFixed(6);
        const accuracy = point.accuracy
          ? Number(point.accuracy).toFixed(2)
          : "N/A";
        const address = (point.address || "").replace(/"/g, '""');
        const deviceInfo = (point.device_info || "").replace(/"/g, '""');

        csv += `"${employee.employee_id}","${employee.first_name} ${employee.last_name}","${employee.email}","${employee.department_id}","'${dateStr}","${timeStr}","${address}",${accuracy},${latitude},${longitude},"${deviceInfo}"\n`;
      });

      // Add summary
      csv += "\n\nSummary:\n";
      csv += `Total Points,${finalPoints.length}\n`;

      let checkInStr = "N/A";
      if (attendance?.check_in) {
        const checkInDate = new Date(attendance.check_in);
        const checkInDay = String(checkInDate.getDate()).padStart(2, "0");
        const checkInMonth = String(checkInDate.getMonth() + 1).padStart(
          2,
          "0",
        );
        const checkInYear = checkInDate.getFullYear();
        const checkInHour = String(checkInDate.getHours()).padStart(2, "0");
        const checkInMin = String(checkInDate.getMinutes()).padStart(2, "0");
        const checkInSec = String(checkInDate.getSeconds()).padStart(2, "0");
        checkInStr = `'${checkInDay}/${checkInMonth}/${checkInYear} ${checkInHour}:${checkInMin}:${checkInSec}`;
      }

      let checkOutStr = "N/A";
      if (attendance?.check_out) {
        const checkOutDate = new Date(attendance.check_out);
        const checkOutDay = String(checkOutDate.getDate()).padStart(2, "0");
        const checkOutMonth = String(checkOutDate.getMonth() + 1).padStart(
          2,
          "0",
        );
        const checkOutYear = checkOutDate.getFullYear();
        const checkOutHour = String(checkOutDate.getHours()).padStart(2, "0");
        const checkOutMin = String(checkOutDate.getMinutes()).padStart(2, "0");
        const checkOutSec = String(checkOutDate.getSeconds()).padStart(2, "0");
        checkOutStr = `'${checkOutDay}/${checkOutMonth}/${checkOutYear} ${checkOutHour}:${checkOutMin}:${checkOutSec}`;
      }

      csv += `Check-In,${checkInStr}\n`;
      csv += `Check-Out,${checkOutStr}\n`;

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment;filename="${employee.employee_id}_location_history_${new Date().toISOString().split("T")[0]}.csv"`,
      );
      return res.send(csv);
    } else if (format === "json") {
      // Return JSON format
      res.json({
        success: true,
        employee: {
          id: employee.id,
          employee_id: employee.employee_id,
          name: `${employee.first_name} ${employee.last_name}`,
          email: employee.email,
        },
        locations: finalPoints,
        summary: {
          totalPoints: finalPoints.length,
          startDate: startDate || null,
          endDate: endDate || null,
          checkIn: attendance?.check_in || null,
          checkOut: attendance?.check_out || null,
        },
      });
    } else {
      return res
        .status(400)
        .json({ success: false, message: "Invalid format. Use csv or json." });
    }
  } catch (error) {
    console.error("Export location history error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to export location history",
    });
  }
};

// Helper functions

module.exports = {
  getAttendanceStatus,
  getAssignedAttendanceClients,
  validateCheckInLocation,
  checkIn,
  checkOut,
  facialRecognitionAttendance,
  getAttendanceLogs,
  getAttendanceByEmployeeAndMonth,
  createOverride,
  processOverride,
  getEmployeeSummary,
  getOverrides,
  postLiveLocation,
  getLiveLocations,
  getLiveLocationHistory,
  exportLocationHistory,
  //getEmployeeShift,
  //determineShiftTyp
};
