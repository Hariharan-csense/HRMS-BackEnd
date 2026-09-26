const express = require("express");
const router = express.Router();
const {
  getAttendanceStatus,
  getAssignedAttendanceClients,
  validateCheckInLocation,
  checkIn,
  checkOut,
  facialRecognitionAttendance,
  facialVerificationAttendance,
  facialRecognitionDescriptorAttendance,
  getAttendanceLogs,
  getAttendanceMonthlyReport,
  getAttendanceByEmployeeAndMonth,
  createOverride,
  processOverride,
  getEmployeeSummary,
  getOverrides,
  postLiveLocation,
  getLiveLocations,
  getLiveLocationHistory,
  exportLocationHistory,
} = require("../controllers/attendanceController");
const { protect } = require("../middleware/authMiddleware");
const uploadAttendanceImage = require("../middleware/attendanceUpload");
const {
  requirePermission,
  requireAnyPermission,
} = require("../middleware/rbacMiddleware");

// Check current attendance status
router.get(
  "/status",
  protect,
  requirePermission("attendance", "view", { submodule: "capture" }),
  getAttendanceStatus,
);

router.get(
  "/assigned-clients",
  protect,
  requirePermission("attendance", "view", { submodule: "capture" }),
  getAssignedAttendanceClients,
);

router.post(
  "/validate-check-in-location",
  protect,
  requirePermission("attendance", "create", { submodule: "capture" }),
  validateCheckInLocation,
);

// Check-in/Check-out routes with file upload
router.post(
  "/check-in",
  protect,
  requirePermission("attendance", "create", { submodule: "capture" }),
  uploadAttendanceImage("image"),
  checkIn,
);
router.post(
  "/check-out",
  protect,
  requirePermission("attendance", "create", { submodule: "capture" }),
  uploadAttendanceImage("image"),
  checkOut,
);

router.post(
  "/facial-recognition",
  protect,
  requirePermission("attendance", "create", {
    submodule: "facial_recognition",
  }),
  uploadAttendanceImage("image"),
  facialRecognitionAttendance,
);

router.post(
  "/facial-recognition/descriptor",
  protect,
  requirePermission("attendance", "create", {
    submodule: "facial_recognition",
  }),
  uploadAttendanceImage("image"),
  facialRecognitionDescriptorAttendance,
);

router.post(
  "/facial-verification",
  protect,
  requirePermission("attendance", "create", { submodule: "capture" }),
  uploadAttendanceImage("image"),
  facialVerificationAttendance,
);

// Get attendance logs with filters
router.get(
  "/logs",
  protect,
  requirePermission("attendance", "view", { submodule: "log" }),
  getAttendanceLogs,
);

// Attendance overrides
router.post(
  "/overrides",
  protect,
  requirePermission("attendance", "create", { submodule: "override" }),
  createOverride,
);
router.put(
  "/overrides/:overrideId/process",
  protect,
  requireAnyPermission([
    { module: "attendance", submodule: "override", action: "approve" },
    { module: "attendance", submodule: "override", action: "reject" },
    { module: "attendance", submodule: "override", action: "update" },
  ]),
  processOverride,
);

// Reports
router.get(
  "/summary/employee/:employeeId",
  protect,
  requirePermission("attendance", "view", { submodule: "log" }),
  getEmployeeSummary,
);
router.get(
  "/monthly-report",
  protect,
  requirePermission("attendance", "view", { submodule: "monthly_report" }),
  getAttendanceMonthlyReport,
);
router.get(
  "/overrides",
  protect,
  requirePermission("attendance", "view", { submodule: "override" }),
  getOverrides,
);
router.post(
  "/locations",
  protect,
  requirePermission("attendance", "create", { submodule: "capture" }),
  postLiveLocation,
);
router.get(
  "/locations",
  protect,
  requirePermission("live_tracking", "view"),
  getLiveLocations,
);
router.get(
  "/locations/:employeeId/history",
  protect,
  requirePermission("live_tracking", "view"),
  getLiveLocationHistory,
);
router.get(
  "/locations/:employeeId/export",
  protect,
  requirePermission("live_tracking", "view"),
  exportLocationHistory,
);

// Payroll helper: employee monthly attendance (employee code or id)
router.get(
  "/:employeeId/:month",
  protect,
  requirePermission("attendance", "view"),
  getAttendanceByEmployeeAndMonth,
);

module.exports = router;
