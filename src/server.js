const express = require("express");
const path = require("path");
const cors = require("cors");
const dotenv = require("dotenv");
dotenv.config();
dotenv.config({ path: path.join(__dirname, "..", ".env"), override: false });
const fs = require("fs");
const http = require("http");
const { Server } = require("socket.io");
const { setIo } = require("./socket");
const { initializeFirebaseAdmin } = require("./services/firebaseAdmin");
const { uploadRoot } = require("./utils/uploadPaths");
const {
  closeExpiredRequirements,
} = require("./controllers/jobRequirementsController");
const app = express();
const PORT = process.env.PORT || 3000;
const server = http.createServer(app);
const io = new Server(server, {
  path: "/backend/socket.io",
  cors: {
    origin: true,
    credentials: true,
  },
});

setIo(io);
initializeFirebaseAdmin();

io.on("connection", (socket) => {
  socket.on("join:company", (companyId) => {
    if (!companyId) return;
    socket.join(`company:${companyId}`);
  });

  socket.on("leave:company", (companyId) => {
    if (!companyId) return;
    socket.leave(`company:${companyId}`);
  });
});

app.use(
  cors({
    origin: true, // 🔥 THIS LINE solves everything
    credentials: true,
  }),
);

// Middleware

// app.use(cors({
//   origin: ['http://localhost:3000', 'http://localhost:8080','http://192.168.1.11:8080',  'http://localhost:5173'],
//   credentials: true,
//   methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
//   allowedHeaders: ['Content-Type', 'Authorization'],
//   preflightContinue: false
// }));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

const serveUploadedFile = (req, res, next) => {
  const relativeUploadPath = String(req.path || "")
    .replace(/^\/backend\/uploads\/?/, "")
    .replace(/^\/uploads\/?/, "")
    .replace(/^\/+/, "");

  if (!relativeUploadPath || relativeUploadPath.includes("..")) {
    return next();
  }

  const candidatePath = path.join(uploadRoot, relativeUploadPath);

  if (fs.existsSync(candidatePath) && fs.statSync(candidatePath).isFile()) {
    return res.sendFile(candidatePath);
  }

  return next();
};
app.get(["/uploads/*", "/backend/uploads/*"], serveUploadedFile);
app.use("/backend/uploads", express.static(uploadRoot));
app.use("/uploads", express.static(uploadRoot));

// Import routes
const demoRoutes = require("./routes/demo");
const authRoutes = require("./routes/authRoutes");
const branchRoutes = require("./routes/branchRoutes");
const departmentRoutes = require("./routes/departmentRoutes");
const companyRoutes = require("./routes/company");
const companyPolicyRoutes = require("./routes/companyPolicyRoutes");
const designationRoutes = require("./routes/designationRoutes");
const assetRoutes = require("./routes/assetRoutes");
const attendanceRoutes = require("./routes/attendanceRoutes");
const expenseRoutes = require("./routes/expenseRoutes");
const employeeRoutes = require("./routes/employeeRoutes");
const leaveRoutes = require("./routes/leaveRoutes");
const roleRoutes = require("./routes/roleRoutes");
const payrollRoutes = require("./routes/payrollRoutes");
const autoNumberRoutes = require("./routes/autoNumberroutes");
const resignationRoutes = require("./routes/resignations");
const checklistsRoutes = require("./routes/checklists");
const leaveTypeRoutes = require("./routes/leaveTypeRoutes");
const holidayRoutes = require("./routes/holidayRoutes");
const fiscalYearRoutes = require("./routes/fiscalYearRoutes");
const leavePolicyRoutes = require("./routes/leavePolicyRoutes");
const reportsRoutes = require("./routes/reports.routes");
const shiftRoutes = require("./routes/shiftRoutes");
const dashboardRoutes = require("./routes/dashboardRoutes");
const kpiDashboardRoutes = require("./routes/kpiDashboardRoutes");
const kpiRoutes = require("./routes/kpiRoutes");
const notificationRoutes = require("./routes/notificationRoutes");
const clientRoutes = require("./routes/clientRoutes");
const clientAttendanceRoutes = require("./routes/clientAttendanceRoutes");
const salesAttendanceRoutes = require("./routes/salesAttendanceRoutes");
const geoFenceRoutes = require("./routes/geoFenceRoutes");
const profileRoutes = require("./routes/profileRoutes");        
const leavePermissionRoutes = require("./routes/leavePermissionRoutes");
const activityRoutes = require("./routes/activityRoutes");
const documentRoutes = require("./routes/documentRoutes");
const ticketRoutes = require("./routes/ticketRoutes");
const hrHelpdeskRoutes = require("./routes/hrHelpdeskRoutes");
const aiAssistantRoutes = require("./routes/aiAssistantRoutes");
const superAdminRoutes = require("./routes/superAdminRoutes");
const subscriptionRoutes = require("./routes/subscriptionRoutes");
const offerLetterRoutes = require("./routes/offerLetterRoutes");
const recruitmentRoutes = require("./routes/recruitmentRoutes");
const jobRequirementsRoutes = require("./routes/jobRequirementsRoutes");
const onboardingRoutes = require("./routes/onboardingRoutes");
const settlementRoutes = require("./routes/settlementRoutes");
const organizationRoutes = require("./routes/organizationRoutes");
const userRoutes = require("./routes/userRoutes");
const surveyRoutes = require("./routes/surveyRoutes");
const pulseSurveyRoutes = require("./routes/pulseSurveyRoutes");
const geocodeRoutes = require("./routes/geocodeRoutes");
const esslRoutes = require("./routes/essl.routes");

// Use routes
app.use("/backend/api/deletion-drafts", require("./routes/deletionDraftRoutes"));
app.use("/backend/api", demoRoutes);
app.use("/backend/api/auth", authRoutes);
app.use("/backend/api/branch", branchRoutes);
app.use("/backend/api/department", departmentRoutes);
app.use("/backend/api/company", companyRoutes);
app.use("/backend/api/company-policy", companyPolicyRoutes);
app.use("/backend/api/designation", designationRoutes);
app.use("/backend/api/asset", assetRoutes);
app.use("/backend/api/attendance", attendanceRoutes);
app.use("/backend/api/employee", employeeRoutes);
app.use("/backend/api/leave", leaveRoutes);
app.use("/backend/api/role", roleRoutes);
app.use("/backend/api/payroll", payrollRoutes);
app.use("/backend/api/autonumber", autoNumberRoutes);
app.use("/backend/api/resignations", resignationRoutes);
app.use("/backend/api/checklists", checklistsRoutes);
app.use("/backend/api/leavetype", leaveTypeRoutes);
app.use("/backend/api/holidays", holidayRoutes);
app.use("/backend/api/fiscalyears", fiscalYearRoutes);
app.use("/backend/api/leavepolicy", leavePolicyRoutes);
app.use("/backend/api/reports", reportsRoutes);
app.use("/backend/api/shifts", shiftRoutes);
app.use("/backend/api/dashboard", kpiDashboardRoutes);
app.use("/backend/api/dashboard", dashboardRoutes);
app.use("/backend/api/kpi", kpiRoutes);
app.use("/backend/api/notifications", notificationRoutes);
app.use("/backend/api/clients", clientRoutes);
app.use("/backend/api/client-attendance", clientAttendanceRoutes);
app.use("/backend/api/sales-attendance", salesAttendanceRoutes);
app.use("/backend/api/geo-fence", geoFenceRoutes);
app.use("/backend/api/expenses", expenseRoutes);
app.use("/backend/api/profile", profileRoutes);
app.use("/backend/api/leave-permission", leavePermissionRoutes);
app.use("/backend/api/activities", activityRoutes);
app.use("/backend/api/documents", documentRoutes);
app.use("/backend/api/tickets", ticketRoutes);
app.use("/backend/api/hr-helpdesk", hrHelpdeskRoutes);
app.use("/backend/api/ai-assistant", aiAssistantRoutes);
app.use("/backend/api/superadmin", superAdminRoutes);
app.use("/backend/api/subscription", subscriptionRoutes);
app.use("/backend/api/offer-letters", offerLetterRoutes);
app.use("/backend/api/recruitment", recruitmentRoutes);
app.use("/backend/api/job-requirements", jobRequirementsRoutes);
app.use("/backend/api/onboarding", onboardingRoutes);
app.use("/backend/api/settlement", settlementRoutes);
app.use("/backend/api/organizations", organizationRoutes);
app.use("/backend/api/users", userRoutes);
app.use("/backend/api/surveys", surveyRoutes);
app.use("/backend/api/pulse-surveys", pulseSurveyRoutes);
app.use("/backend/api/geocode", geocodeRoutes);
app.use("/backend/api", esslRoutes);

app.get("/backend/api/config/maps", (req, res) => {
  const googleMapsApiKey =
    process.env.GOOGLE_MAPS_BROWSER_API_KEY ||
    process.env.GOOGLE_MAPS_API_KEY ||
    process.env.VITE_GOOGLE_MAPS_API_KEY ||
    "";

  res.set("Cache-Control", "no-store");
  res.json({
    googleMapsApiKey,
    hasGoogleMapsApiKey: Boolean(googleMapsApiKey),
  });
});

// Root route
app.get("/", (req, res) => {
  res.send("Hello from HRMS Backend! 🚀");
});

// 404 handler (optional - good practice)
app.use("*", (req, res) => {
  res.status(404).json({ message: "Route not found" });
});

// Start server
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  const syncExpiredRequirements = () => {
    closeExpiredRequirements().catch((error) => {
      console.error("Failed to auto-close expired job requirements:", error);
    });
  };

  syncExpiredRequirements();
  const requirementClosingTimer = setInterval(
    syncExpiredRequirements,
    15 * 60 * 1000,
  );
  requirementClosingTimer.unref();
  require("./services/esslSyncService")
    .startScheduledSync()
    .catch(() => {
      console.error("eSSL scheduler could not be initialized. Check database connectivity.");
    });
  require("./services/company51AutoCheckoutService").startCompany51AutoCheckout();
  //console.log(`Uploads available at: http://localhost:${PORT}/uploads`);
});
