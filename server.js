const express = require("express");
const path = require('path');
const cors = require('cors');
require('dotenv').config(); 

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use((req, res, next) => {
  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    res.header('Access-Control-Allow-Origin', req.headers.origin);
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.header('Access-Control-Allow-Credentials', 'true');
    return res.status(200).end();
  }
  next();
});

app.use(cors({
  origin: ['http://localhost:3000', 'http://localhost:8080','http://192.168.1.8:8080',  'http://localhost:5173'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  preflightContinue: false
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve uploaded files (images, documents, etc.)
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

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

// Use routes
app.use("/api", demoRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/branch", branchRoutes);
app.use("/api/department", departmentRoutes);
app.use("/api/company", companyRoutes);
app.use("/api/designation", designationRoutes);
app.use("/api/asset", assetRoutes);
app.use("/api/attendance", attendanceRoutes);
app.use("/api/expense", expenseRoutes);
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