const RBAC_ACTIONS = ["view", "create", "update", "delete", "approve", "reject"];

const RBAC_MODULE_CATALOG = [
  { key: "dashboard", label: "Dashboard", submodules: [] },
  { key: "quick_actions", label: "Quick Actions", submodules: [] },
  {
    key: "organization",
    label: "Organization",
    submodules: [
      { key: "company", label: "Company" },
      { key: "branches", label: "Branches" },
      { key: "departments", label: "Departments" },
      { key: "designations", label: "Designations" },
      { key: "role_management", label: "Role Management" },
    ],
  },
  {
    key: "employees",
    label: "Employees",
    submodules: [
      { key: "list", label: "Employee List" },
      { key: "profile", label: "Profile" },
      { key: "reports", label: "Employee Reports" },
    ],
  },
  {
    key: "hr_management",
    label: "HR Management",
    submodules: [
      { key: "requirements", label: "Requirements" },
      { key: "recruitment", label: "Recruitment" },
      { key: "offer_letters", label: "Offer Letters" },
      { key: "onboarding", label: "Onboarding" },
    ],
  },
  { key: "client_attendance", label: "Client Attendance", submodules: [] },
  { key: "client_attendance_admin", label: "Client Attendance Admin", submodules: [] },
  { key: "my_clients", label: "My Clients", submodules: [] },
  { key: "my_analytics", label: "My Analytics", submodules: [] },
  {
    key: "attendance",
    label: "Attendance",
    submodules: [
      { key: "capture", label: "Check-In/Out" },
      { key: "log", label: "Attendance Log" },
      { key: "override", label: "Override" },
      { key: "shift", label: "Shift Management" },
    ],
  },
  { key: "shift_management", label: "Shift Management", submodules: [] },
  { key: "live_tracking", label: "Live Tracking", submodules: [] },
  {
    key: "leave",
    label: "Leave",
    submodules: [
      { key: "apply", label: "Apply Leave" },
      { key: "balance", label: "Leave Balance" },
      { key: "approvals", label: "Leave Approvals" },
      { key: "config", label: "Leave Config" },
      { key: "applications", label: "Applications" },
      { key: "permission", label: "Permission" },
      { key: "configuration", label: "Configuration" },
    ],
  },
  {
    key: "payroll",
    label: "Payroll",
    submodules: [
      { key: "salary_structure", label: "Salary Structure" },
      { key: "processing", label: "Processing" },
      { key: "payslips", label: "Payslips" },
    ],
  },
  {
    key: "expenses",
    label: "Expenses",
    submodules: [
      { key: "claims", label: "Claims" },
      { key: "approvals", label: "Approvals" },
      { key: "export", label: "Export" },
    ],
  },
  {
    key: "assets",
    label: "Assets",
    submodules: [{ key: "list", label: "Asset List" }],
  },
  {
    key: "exit",
    label: "Exit",
    submodules: [
      { key: "resignations", label: "Resignations" },
      { key: "checklist", label: "Exit Checklist" },
      { key: "settlement", label: "F&F Settlement" },
    ],
  },
  {
    key: "reports",
    label: "Reports",
    submodules: [
      { key: "attendance", label: "Attendance Reports" },
      { key: "payroll", label: "Payroll Reports" },
      { key: "leave", label: "Leave Reports" },
      { key: "finance", label: "Finance Reports" },
      { key: "export_data", label: "Export Data" },
      { key: "employee_reports", label: "Employee Reports" },
    ],
  },
  { key: "tickets", label: "Tickets", submodules: [] },
  {
    key: "pulse_surveys",
    label: "Pulse Surveys",
    submodules: [
      { key: "dashboard", label: "Overview" },
      { key: "results", label: "Results" },
      { key: "create", label: "Create Survey" },
      { key: "templates", label: "Templates" },
      { key: "feedback_inbox", label: "Feedback Inbox" },
      { key: "my_surveys", label: "My Surveys" },
      { key: "feedback", label: "Send Feedback" },
      { key: "respond", label: "Respond Survey" },
    ],
  },
  { key: "subscription", label: "Subscription", submodules: [] },
  { key: "subscription_plans", label: "Subscription Plans", submodules: [] },
  { key: "organizations", label: "Organizations", submodules: [] },
  { key: "users", label: "Users", submodules: [] },
  { key: "role_access", label: "Role Access", submodules: [] },
];

module.exports = {
  RBAC_ACTIONS,
  RBAC_MODULE_CATALOG,
};
