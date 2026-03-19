const express = require("express");
const path = require('path');
const fs = require('fs');
const cors = require('cors');
require('dotenv').config(); 

const app = express();
const PORT = process.env.PORT || 3000;

const configuredCorsOrigins = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const allowedOrigins = new Set([
  "http://localhost:3000",
  "http://localhost:8080",
  "http://localhost:5173",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:5173",
  "http://192.168.1.12:8080",
  "http://192.168.1.12:3000",
  
  "capacitor://localhost",
  "ionic://localhost",
  ...configuredCorsOrigins,
]);

const corsOptions = {
  origin: (origin, callback) => {
    // Allow server-to-server, Postman, native mobile, and explicit browser origins.
    if (!origin || allowedOrigins.has(origin)) {
      return callback(null, true);
    }

    return callback(new Error(`CORS blocked for origin ${origin}`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  preflightContinue: false,
};

// Middleware
app.use((req, res, next) => {
  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    const requestOrigin = req.headers.origin;
    if (!requestOrigin || allowedOrigins.has(requestOrigin)) {
      if (requestOrigin) {
        res.header('Access-Control-Allow-Origin', requestOrigin);
      }
      res.header('Vary', 'Origin');
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.header('Access-Control-Allow-Credentials', 'true');
      return res.status(200).end();
    }

    return res.status(403).json({ message: 'CORS origin denied' });
  }
  next();
});

app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Allow deployments that prefix routes with /backend (e.g., reverse proxy)
app.use((req, res, next) => {
  if (req.url.startsWith("/backend/")) {
    req.url = req.url.replace(/^\/backend/, "");
  }
  next();
});

// Serve uploaded files. Some older middleware writes to the workspace root
// `uploads/` while other modules use `backend/uploads/`, so expose both.
const rootUploadsPath = path.resolve(__dirname, '..', 'uploads');
const backendUploadsPath = path.resolve(__dirname, 'uploads');
app.get('/uploads/*', (req, res, next) => {
  const relativeUploadPath = String(req.path || '')
    .replace(/^\/uploads\/?/, '')
    .replace(/^\/+/, '');

  if (!relativeUploadPath || relativeUploadPath.includes('..')) {
    return next();
  }

  const candidates = [
    path.join(rootUploadsPath, relativeUploadPath),
    path.join(backendUploadsPath, relativeUploadPath),
  ];

  const existingFile = candidates.find((filePath) => fs.existsSync(filePath) && fs.statSync(filePath).isFile());
  if (existingFile) {
    return res.sendFile(existingFile);
  }

  return next();
});
app.use('/uploads', express.static(rootUploadsPath));
app.use('/uploads', express.static(backendUploadsPath));

// Import routes
const demoRoutes = require("./routes/demo");
const authRoutes = require("./routes/authRoutes");
const branchRoutes = require("./routes/branchRoutes");
const departmentRoutes = require("./routes/departmentRoutes");
const companyRoutes = require("./routes/company");
const designationRoutes = require("./routes/designationRoutes");
const assetRoutes = require("./routes/assetRoutes");
const attendanceRoutes = require("./routes/attendanceRoutes");
const expenseRoutes = require("./routes/expenseRoutes");
const employeeRoutes = require("./routes/employeeRoutes");
const leaveRoutes = require("./routes/leaveRoutes");
const roleRoutes = require("./routes/roleRoutes");
const payrollRoutes = require("./routes/payrollRoutes");
const autoNumberRoutes = require("./routes/autoNumberroutes");
const resignationRoutes = require('./routes/resignations');
const checklistsRoutes = require('./routes/checklists');
const leaveTypeRoutes = require('./routes/leaveTypeRoutes');
const holidayRoutes = require('./routes/holidayRoutes');
const fiscalYearRoutes = require('./routes/fiscalYearRoutes');
const leavePolicyRoutes = require('./routes/leavePolicyRoutes');
const reportsRoutes = require('./routes/reports.routes');
const shiftRoutes = require("./routes/shiftRoutes");
const dashboardRoutes = require('./routes/dashboardRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const clientRoutes = require('./routes/clientRoutes');
const clientAttendanceRoutes = require('./routes/clientAttendanceRoutes');
const salesAttendanceRoutes = require('./routes/salesAttendanceRoutes');
const geoFenceRoutes = require('./routes/geoFenceRoutes');
const profileRoutes = require('./routes/profileRoutes');
const leavePermissionRoutes = require('./routes/leavePermissionRoutes');
const activityRoutes = require('./routes/activityRoutes');
const documentRoutes = require('./routes/documentRoutes');
const ticketRoutes = require('./routes/ticketRoutes');
const superAdminRoutes = require('./routes/superAdminRoutes');
const subscriptionRoutes = require('./routes/subscriptionRoutes');
const offerLetterRoutes = require('./routes/offerLetterRoutes');
const recruitmentRoutes = require('./routes/recruitmentRoutes');
const jobRequirementsRoutes = require('./routes/jobRequirementsRoutes');
const onboardingRoutes = require('./routes/onboardingRoutes');
const settlementRoutes = require('./routes/settlementRoutes');
const organizationRoutes = require('./routes/organizationRoutes');
const userRoutes = require('./routes/userRoutes');
const surveyRoutes = require('./routes/surveyRoutes');
const pulseSurveyRoutes = require('./routes/pulseSurveyRoutes');
const geocodeRoutes = require("./routes/geocodeRoutes");




// Use routes
app.use("/api", demoRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/branch", branchRoutes);
app.use("/api/department", departmentRoutes);
app.use("/api/company", companyRoutes);
app.use("/api/designation", designationRoutes);
app.use("/api/asset", assetRoutes);
app.use("/api/attendance", attendanceRoutes);
app.use("/api/employee", employeeRoutes);
app.use("/api/leave", leaveRoutes);
app.use("/api/role", roleRoutes);
app.use("/api/payroll", payrollRoutes);
app.use("/api/autonumber", autoNumberRoutes);
app.use('/api/resignations',resignationRoutes);
app.use('/api/checklists',checklistsRoutes);
app.use('/api/leavetype', leaveTypeRoutes);
app.use('/api/holidays', holidayRoutes);
app.use('/api/fiscalyears', fiscalYearRoutes);
app.use('/api/leavepolicy', leavePolicyRoutes);
app.use('/api/reports', reportsRoutes);
app.use("/api/shifts", shiftRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/clients', clientRoutes);
app.use('/api/client-attendance', clientAttendanceRoutes);
app.use('/api/sales-attendance', salesAttendanceRoutes);
app.use('/api/geo-fence', geoFenceRoutes);
app.use("/api/expenses", expenseRoutes);
app.use("/api/profile", profileRoutes);
app.use("/api/leave-permission", leavePermissionRoutes);
app.use("/api/activities", activityRoutes);
app.use("/api/documents", documentRoutes);
app.use("/api/tickets", ticketRoutes);
app.use("/api/superadmin", superAdminRoutes);
app.use("/api/subscription", subscriptionRoutes);
app.use("/api/offer-letters", offerLetterRoutes);
app.use("/api/recruitment", recruitmentRoutes);
app.use("/api/job-requirements", jobRequirementsRoutes);
app.use("/api/onboarding", onboardingRoutes);
app.use("/api/settlement", settlementRoutes);
app.use("/api/organizations", organizationRoutes);
app.use("/api/users", userRoutes);
app.use("/api/surveys", surveyRoutes);
app.use("/api/pulse-surveys", pulseSurveyRoutes);
app.use("/api/geocode", geocodeRoutes);




// Root route
app.get("/", (req, res) => {
  res.send("Hello from HRMS Backend! 🚀");
});

// 404 handler (optional - good practice)
app.use('*', (req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  //console.log(`Uploads available at: http://localhost:${PORT}/uploads`);
});
