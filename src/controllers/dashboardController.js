// src/controllers/adminDashboardController.js
const knex = require("../db/db"); // Adjust path if needed
const {
  addDaysToDateKey,
  formatTime,
  getDateKey,
  getZonedDateParts,
} = require("../utils/dateTime");
const { getCompanyPolicy } = require("../services/companyPolicyService");
const {
  isLeaveTypeEligibleForEmployee,
  assignLeaveBalancesForEmployee,
  reconcileMissingLeaveBalances,
  getLeaveCycleForDate,
} = require("../services/leaveBalanceService");

const getRelativeTime = (dateString) => {
  if (!dateString) return "Unknown time";
  const now = new Date();
  const target = new Date(dateString);
  const diffMs = now.getTime() - target.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);
  const diffDays = diffMs / (1000 * 60 * 60 * 24);

  if (diffMs < 0) return "In the future";
  if (diffHours < 1) return "Just now";
  if (diffHours < 24)
    return `${Math.round(diffHours)} hour${diffHours > 1 ? "s" : ""} ago`;
  if (diffDays < 7)
    return `${Math.round(diffDays)} day${diffDays > 1 ? "s" : ""} ago`;
  return "Older";
};

const resolveEmployeeIdFromUser = async (req) => {
  const companyId = Number(req.user?.company_id);
  if (!companyId) return null;

  const direct = await knex("employees")
    .where({ id: Number(req.user?.id), company_id: companyId })
    .first();
  if (direct) return Number(direct.id);

  if (req.user?.email) {
    const byEmail = await knex("employees")
      .where("company_id", companyId)
      .whereRaw("LOWER(email) = ?", [
        String(req.user.email).toLowerCase().trim(),
      ])
      .first();
    if (byEmail) return Number(byEmail.id);
  }

  return null;
};

const timeToMinutes = (value) => {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
};

const getPermissionUnits = (fromTime, toTime, hoursPerPermission) => {
  const fromMinutes = timeToMinutes(fromTime);
  const toMinutes = timeToMinutes(toTime);
  if (fromMinutes === null || toMinutes === null || toMinutes <= fromMinutes) {
    return 1;
  }

  const durationHours = (toMinutes - fromMinutes) / 60;
  return Math.max(1, Math.ceil(durationHours / hoursPerPermission));
};

const monthsForPeriod = (period = "6months") => {
  const map = {
    "1month": 1,
    "3months": 3,
    "6months": 6,
    "1year": 12,
  };
  const count = map[period] || 6;
  const now = new Date();
  const list = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    list.push({
      year: d.getFullYear(),
      month: d.getMonth() + 1,
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      short: d.toLocaleString("en-US", { month: "short" }),
    });
  }
  return list;
};

const getAdminDashboardData = async (req, res) => {
  try {
    const companyId = req.user.company_id;

    if (!companyId) {
      return res
        .status(400)
        .json({ message: "You are not assigned to any company" });
    }

    const today = getDateKey();
    const yesterdayStr = addDaysToDateKey(today, -1);

    // ==================== Base Data ====================
    const totalEmployeesResult = await knex("employees")
      .where({ company_id: companyId, status: "active" })
      .count("* as count")
      .first();
    const totalEmployees = Number(totalEmployeesResult?.count || 0);

    const attendanceTodayRaw = await knex("attendance as a")
      .innerJoin("employees as e", function () {
        this.on("a.employee_id", "=", "e.id").andOn(
          "a.company_id",
          "=",
          "e.company_id",
        );
      })
      .where("a.company_id", companyId)
      .where("e.status", "active")
      .whereRaw("DATE(a.check_in) = ?", [today])
      .select("a.*");

    const presentToday = new Set(
      attendanceTodayRaw
        .filter((a) =>
          ["present", "late"].includes(
            String(a.status || "")
              .toLowerCase()
              .trim(),
          ),
        )
        .map((a) => Number(a.employee_id)),
    ).size;
    const totalAttendanceToday = attendanceTodayRaw.length;
    const flaggedToday = attendanceTodayRaw.filter(
      (a) => a.auto_flag === 1,
    ).length;

    const presentTodayEmployees = await knex("attendance as a")
      .leftJoin("employees as e", "a.employee_id", "e.id")
      .leftJoin("departments as d", "e.department_id", "d.id")
      .where("a.company_id", companyId)
      .where("e.company_id", companyId)
      .where("e.status", "active")
      .whereRaw("DATE(a.check_in) = ?", [today])
      .whereRaw("LOWER(TRIM(a.status)) IN ('present','late')")
      .select(
        "e.id",
        "e.employee_id",
        "e.first_name",
        "e.last_name",
        "e.email",
        "d.name as department",
        "a.status",
        "a.check_in",
      )
      .orderBy("a.check_in", "asc");

    // An employee can have more than one attendance row for a day. Keep one
    // entry in the dashboard modal so its list matches the KPI count.
    const uniquePresentTodayEmployees = Array.from(
      new Map(
        presentTodayEmployees.map((employee) => [employee.id, employee]),
      ).values(),
    );

    const presentYesterdayResult = await knex("attendance as a")
      .innerJoin("employees as e", function () {
        this.on("a.employee_id", "=", "e.id").andOn(
          "a.company_id",
          "=",
          "e.company_id",
        );
      })
      .where("a.company_id", companyId)
      .where("e.status", "active")
      .whereRaw("DATE(a.check_in) = ?", [yesterdayStr])
      .whereRaw("LOWER(TRIM(a.status)) IN ('present','late')")
      .countDistinct("a.employee_id as count")
      .first();
    const presentYesterday = Number(presentYesterdayResult?.count || 0);

    const onLeave = await knex("leave_applications")
      .where({ company_id: companyId, status: "approved" })
      .whereRaw(`? BETWEEN from_date AND to_date`, [today])
      .countDistinct("employee_id as count")
      .first()
      .then((r) => Number(r?.count || 0));

    const onLeaveEmployees = await knex("leave_applications as la")
      .leftJoin("employees as e", "la.employee_id", "e.id")
      .leftJoin("departments as d", "e.department_id", "d.id")
      .where("la.company_id", companyId)
      .where("la.status", "approved")
      .whereRaw(`? BETWEEN la.from_date AND la.to_date`, [today])
      .select(
        "e.id",
        "e.employee_id",
        "e.first_name",
        "e.last_name",
        "e.email",
        "d.name as department",
        "la.leave_type_name",
        "la.from_date",
        "la.to_date",
      )
      .orderBy("e.first_name", "asc");

    const pendingApprovals = await knex("leave_applications")
      .where({ company_id: companyId, status: "pending" })
      .count("* as count")
      .first()
      .then((r) => Number(r?.count || 0));

    const pendingApprovalItemsRaw = await knex("leave_applications as la")
      .leftJoin("employees as e", "la.employee_id", "e.id")
      .where("la.company_id", companyId)
      .where("la.status", "pending")
      .select(
        "la.id",
        "la.leave_type_name",
        "la.created_at",
        "e.employee_id",
        "e.first_name",
        "e.last_name",
      )
      .orderBy("la.created_at", "desc")
      .limit(20);

    // Keep the dashboard in sync with approved leave applications. Balances can
    // otherwise remain stale when an approval was imported or updated outside
    // the normal leave-balance screen.
    const leaveCycle = await getLeaveCycleForDate(knex, companyId, today);
    await reconcileMissingLeaveBalances({
      companyId,
      year: leaveCycle.year,
      cycle: leaveCycle,
    });

    const leaveUtilization = await knex("leave_balances as lb")
      .join("employees as e", "lb.employee_id", "e.id")
      .where("lb.company_id", companyId)
      .where("lb.year", leaveCycle.year)
      .whereRaw("LOWER(TRIM(COALESCE(e.status, ''))) = ?", ["active"])
      .select(
        knex.raw("COALESCE(SUM(lb.availed), 0) as used"),
        knex.raw("COALESCE(SUM(lb.available), 0) as remaining"),
      )
      .first();

    const usedLeave = Number(leaveUtilization?.used || 0);
    const remainingLeave = Number(leaveUtilization?.remaining || 0);
    const totalLeave = usedLeave + remainingLeave;
    const leaveBalanceHealth =
      totalLeave > 0 ? Math.round((remainingLeave / totalLeave) * 100) : 0;
    const utilizedPercentage =
      totalLeave > 0 ? Number(((usedLeave / totalLeave) * 100).toFixed(1)) : 0;
    const availablePercentage =
      totalLeave > 0
        ? Number(((remainingLeave / totalLeave) * 100).toFixed(1))
        : 0;

    const leaveData = [
      {
        name: "Utilized",
        value: utilizedPercentage,
        unit: "%",
        fill: "#ef4444",
      },
      {
        name: "Available",
        value: availablePercentage,
        unit: "%",
        fill: "#10b981",
      },
    ];

    // ==================== Dynamic Metrics ====================
    const attendanceScore =
      totalEmployees > 0
        ? Math.round((presentToday / totalEmployees) * 100)
        : 0;
    const previousAttendanceScore =
      totalEmployees > 0
        ? Math.round((presentYesterday / totalEmployees) * 100)
        : attendanceScore;

    const trendValue = attendanceScore - previousAttendanceScore;
    const trend =
      trendValue > 0
        ? `↑ ${trendValue}%`
        : trendValue < 0
          ? `↓ ${Math.abs(trendValue)}%`
          : "No change";

    const payrollValue = 100;

    const complianceScore =
      totalAttendanceToday > 0
        ? Math.round(100 - (flaggedToday / totalAttendanceToday) * 100)
        : 100;

    const overallScore = Math.round(
      (attendanceScore + leaveBalanceHealth + payrollValue + complianceScore) /
        4,
    );

    const status =
      overallScore >= 85
        ? "Excellent Health"
        : overallScore >= 70
          ? "Good Health Status"
          : "Needs Attention";

    // ==================== Strengths & Improvements ====================
    const strengths = [];
    const improvements = [];

    strengths.push("Payroll processing 100% on schedule");

    if (complianceScore >= 95) {
      strengths.push("Excellent compliance – minimal/no flagged records");
    } else if (complianceScore >= 80) {
      strengths.push(`Good compliance (${complianceScore}%)`);
    } else {
      improvements.push(
        `Compliance needs review (${complianceScore}%) – ${flaggedToday} flagged record${flaggedToday > 1 ? "s" : ""} today`,
      );
    }

    if (attendanceScore >= 95) {
      strengths.push(`Outstanding attendance (${attendanceScore}%)`);
    } else if (attendanceScore >= 80) {
      strengths.push(`Good attendance rate (${attendanceScore}%)`);
    } else if (attendanceScore > 0) {
      improvements.push(`Low attendance today (${attendanceScore}%)`);
    }

    if (leaveBalanceHealth >= 90) {
      strengths.push(`Excellent leave balance health (${leaveBalanceHealth}%)`);
    } else if (leaveBalanceHealth >= 70) {
      strengths.push(`Healthy leave utilization (${leaveBalanceHealth}%)`);
    } else {
      improvements.push(
        `Leave balance health low (${leaveBalanceHealth}%) – encourage leave taking`,
      );
    }

    if (pendingApprovals === 0) {
      strengths.push("All leave requests processed promptly");
    } else {
      improvements.push(
        `${pendingApprovals} pending leave approval${pendingApprovals > 1 ? "s" : ""}`,
      );
    }

    const teamHealth = {
      overallScore,
      status,
      trend,
      lastUpdated: "Today",
      metrics: [
        {
          label: "Attendance Score",
          value: attendanceScore,
          color:
            attendanceScore >= 90
              ? "bg-green-500"
              : attendanceScore >= 70
                ? "bg-yellow-500"
                : "bg-red-500",
        },
        {
          label: "Leave Balance Health",
          value: leaveBalanceHealth,
          color:
            leaveBalanceHealth >= 80
              ? "bg-green-500"
              : leaveBalanceHealth >= 60
                ? "bg-yellow-500"
                : "bg-red-500",
        },
        {
          label: "Payroll Status",
          value: payrollValue,
          color: "bg-green-500",
        },
        {
          label: "Compliance Score",
          value: complianceScore,
          color:
            complianceScore >= 90
              ? "bg-green-500"
              : complianceScore >= 70
                ? "bg-yellow-500"
                : "bg-red-500",
        },
      ],
      strengths,
      improvements,
    };

    // ==================== Recent Activities ====================
    const activities = [];

    const recentApprovedLeaves = await knex("leave_applications")
      .where({ company_id: companyId, status: "approved" })
      .select("employee_name", "leave_type_name", "approved_at")
      .orderBy("approved_at", "desc")
      .limit(10);

    recentApprovedLeaves.forEach((leave) => {
      if (leave.approved_at) {
        activities.push({
          activity: `${leave.leave_type_name || "Leave"} approved for ${leave.employee_name}`,
          time: getRelativeTime(leave.approved_at),
          icon: "✓",
          timestamp: new Date(leave.approved_at).getTime(),
        });
      }
    });

    // Recent Joinings with Department Name Join
    const recentJoiningsRaw = await knex("employees as e")
      .leftJoin("departments as d", "e.department_id", "d.id")
      .where("e.company_id", companyId)
      .where("e.status", "active")
      .select(
        "e.first_name",
        "e.last_name",
        "e.role",
        "e.doj as join_date",
        "d.name as dept_name",
      )
      .orderBy("e.doj", "desc")
      .limit(10);

    recentJoiningsRaw.forEach((emp) => {
      if (emp.join_date) {
        activities.push({
          activity: `New employee onboarded: ${emp.first_name} ${emp.last_name}${emp.role ? ` (${emp.role})` : ""}`,
          time: getRelativeTime(emp.join_date),
          icon: "👤",
          timestamp: new Date(emp.join_date).getTime(),
        });
      }
    });

    activities.sort((a, b) => b.timestamp - a.timestamp);
    let recentActivities = activities
      .slice(0, 5)
      .map(({ timestamp, ...rest }) => rest);

    if (recentActivities.length === 0) {
      recentActivities = [
        { activity: "No recent activities", time: "—", icon: "📌" },
      ];
    }

    // Recent Joinings Card (with proper department name)
    const recentJoinings = recentJoiningsRaw.slice(0, 3).map((emp) => ({
      name: `${emp.first_name} ${emp.last_name}`,
      role: emp.role || "N/A",
      dept: emp.dept_name || "No Department",
      joinDate: new Date(emp.join_date).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      }),
    }));

    // Upcoming Birthdays
    const { month: currentMonth, day: currentDay } = getZonedDateParts();

    // Ensure birthdays are scoped to the requested company only
    const upcomingBirthdaysRaw = await knex("employees as e")
      .where("e.company_id", companyId)
      .where("e.status", "active")
      .whereNotNull("e.dob")
      // include company_id for an extra safety-check below
      .select(
        "e.first_name",
        "e.last_name",
        "e.dob as birth_date",
        "e.company_id",
      )
      .whereRaw(
        `(MONTH(e.dob) = ? AND DAY(e.dob) >= ?) OR (MONTH(e.dob) > ?)`,
        [currentMonth, currentDay, currentMonth],
      )
      .orderByRaw("MONTH(e.dob), DAY(e.dob)")
      .limit(3);

    // Extra safety: ensure returned rows truly belong to the requested company
    const filteredBirthdays = upcomingBirthdaysRaw.filter(
      (emp) => Number(emp.company_id) === Number(companyId),
    );

    const upcomingBirthdays = filteredBirthdays.map((emp) => {
      const bdate = new Date(emp.birth_date);
      const isToday =
        bdate.getMonth() + 1 === currentMonth && bdate.getDate() === currentDay;
      return {
        name: `${emp.first_name} ${emp.last_name}`,
        date: isToday
          ? "Today"
          : bdate.toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
            }),
        emoji: "🎂",
      };
    });

    // Upcoming Holidays
    const upcomingHolidaysRaw = await knex("holidays")
      .where({ company_id: companyId })
      .whereRaw("date >= ?", [today])
      .select("name", "date", "type")
      .orderBy("date")
      .limit(4);

    const upcomingHolidays = upcomingHolidaysRaw.map((h) => ({
      name: h.name,
      date: new Date(h.date).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      }),
      type: h.type === "national" ? "Public Holiday" : "Company Holiday",
      icon: h.type === "national" ? "🇮🇳" : "🏢",
    }));

    // Monthly Attendance
    const monthlyAttendance = await knex("attendance")
      .where({ company_id: companyId })
      .whereRaw("DATE(check_in) >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH)")
      .select(
        knex.raw(`DATE_FORMAT(check_in, '%b-%Y') as month`),
        knex.raw(
          `COUNT(CASE WHEN LOWER(TRIM(status)) IN ('present','late') THEN 1 END) as present`,
        ),
        knex.raw(
          `COUNT(CASE WHEN LOWER(TRIM(status)) = 'absent' THEN 1 END) as absent`,
        ),
        knex.raw(
          `COUNT(CASE WHEN LOWER(TRIM(status)) = 'half_day' THEN 1 END) as half`,
        ),
      )
      .groupByRaw(`DATE_FORMAT(check_in, '%b-%Y')`)
      .orderByRaw(`MIN(check_in)`);

    // Department Headcount with Proper Names
    let departmentData = [];
    try {
      const departmentRaw = await knex("employees as e")
        .leftJoin("departments as d", "e.department_id", "d.id")
        .where("e.company_id", companyId)
        .where("e.status", "active")
        .select("d.name as dept")
        .count("e.id as count")
        .groupBy("d.name")
        .orderBy("count", "desc");

      departmentData = departmentRaw
        .filter((d) => d.dept !== null) // Skip employees with no department
        .map((d) => ({
          dept: d.dept || "Unassigned",
          count: Number(d.count),
        }));

      // Add "Unassigned" count if any employees have NULL department_id
      const unassignedCount = await knex("employees")
        .where({ company_id: companyId, status: "active" })
        .whereNull("department_id")
        .count("* as count")
        .first();

      if (Number(unassignedCount?.count || 0) > 0) {
        departmentData.push({
          dept: "Unassigned",
          count: Number(unassignedCount.count),
        });
      }
    } catch (err) {
      console.error(
        "Department chart error (maybe departments table missing?):",
        err,
      );
      departmentData = [];
    }

    // Department-wise Attendance for Today
    let departmentAttendanceData = [];
    try {
      const deptAttendanceRaw = await knex("attendance as a")
        .leftJoin("employees as e", "a.employee_id", "e.id")
        .leftJoin("departments as d", "e.department_id", "d.id")
        .where("a.company_id", companyId)
        .whereRaw("DATE(a.check_in) = ?", [today])
        .select(
          "d.name as dept",
          knex.raw(
            `COUNT(CASE WHEN LOWER(TRIM(a.status)) IN ('present','late') THEN 1 END) as present`,
          ),
          knex.raw(
            `COUNT(CASE WHEN LOWER(TRIM(a.status)) = 'absent' THEN 1 END) as absent`,
          ),
          knex.raw(
            `COUNT(CASE WHEN LOWER(TRIM(a.status)) = 'half_day' THEN 1 END) as half`,
          ),
          knex.raw("COUNT(*) as total"),
        )
        .groupBy("d.name")
        .orderBy("present", "desc");

      departmentAttendanceData = deptAttendanceRaw.map((d) => ({
        dept: d.dept || "Unassigned",
        present: Number(d.present || 0),
        absent: Number(d.absent || 0),
        half: Number(d.half || 0),
        total: Number(d.total || 0),
      }));

      // Add unassigned department attendance
      const unassignedAttendance = await knex("attendance as a")
        .leftJoin("employees as e", "a.employee_id", "e.id")
        .where("a.company_id", companyId)
        .whereRaw("DATE(a.check_in) = ?", [today])
        .whereNull("e.department_id")
        .select(
          knex.raw(
            `COUNT(CASE WHEN LOWER(TRIM(a.status)) IN ('present','late') THEN 1 END) as present`,
          ),
          knex.raw(
            `COUNT(CASE WHEN LOWER(TRIM(a.status)) = 'absent' THEN 1 END) as absent`,
          ),
          knex.raw(
            `COUNT(CASE WHEN LOWER(TRIM(a.status)) = 'half_day' THEN 1 END) as half`,
          ),
          knex.raw("COUNT(*) as total"),
        )
        .first();

      if (Number(unassignedAttendance?.total || 0) > 0) {
        departmentAttendanceData.push({
          dept: "Unassigned",
          present: Number(unassignedAttendance.present || 0),
          absent: Number(unassignedAttendance.absent || 0),
          half: Number(unassignedAttendance.half || 0),
          total: Number(unassignedAttendance.total || 0),
        });
      }
    } catch (err) {
      console.error("Department attendance error:", err);
      departmentAttendanceData = [];
    }

    // ==================== Final Response ====================
    const dashboardData = {
      kpis: {
        totalEmployees,
        presentToday,
        presentTrend:
          totalEmployees > 0
            ? `${((presentToday / totalEmployees) * 100).toFixed(1)}% attendance`
            : "N/A",
        onLeave,
        onLeaveTrend:
          totalEmployees > 0
            ? `${((onLeave / totalEmployees) * 100).toFixed(1)}% of workforce`
            : "N/A",
        pendingApprovals,
        pendingTrend:
          pendingApprovals > 0 ? `${pendingApprovals} pending` : "All clear",
      },
      charts: {
        monthlyAttendance,
        departmentData,
        departmentAttendanceData,
        leaveData,
      },
      recentActivities,
      recentJoinings,
      upcomingBirthdays,
      upcomingHolidays,
      presentTodayEmployees: uniquePresentTodayEmployees.map((emp) => ({
        id: emp.id,
        employeeId: emp.employee_id,
        name:
          `${emp.first_name || ""} ${emp.last_name || ""}`.trim() ||
          "Unnamed Employee",
        email: emp.email || "",
        department: emp.department || "Unassigned",
        status: emp.status || "present",
        checkIn: emp.check_in || null,
      })),
      onLeaveEmployees: onLeaveEmployees.map((emp) => ({
        id: emp.id,
        employeeId: emp.employee_id,
        name:
          `${emp.first_name || ""} ${emp.last_name || ""}`.trim() ||
          "Unnamed Employee",
        email: emp.email || "",
        department: emp.department || "Unassigned",
        leaveType: emp.leave_type_name || "Leave",
        fromDate: emp.from_date || null,
        toDate: emp.to_date || null,
      })),
      pendingApprovals: pendingApprovalItemsRaw.map((item) => ({
        id: item.id,
        name:
          `${item.first_name || ""} ${item.last_name || ""}`.trim() ||
          "Unnamed Employee",
        type: item.leave_type_name
          ? `${item.leave_type_name} leave request`
          : "Leave request",
        category: "leave",
        employeeId: item.employee_id || "",
        createdAt: item.created_at || null,
      })),
      teamHealth,
    };

    res.status(200).json(dashboardData);
  } catch (error) {
    console.error("Dashboard data error:", error);
    res.status(500).json({
      message: "Failed to fetch dashboard data",
      error: error.message,
    });
  }
};

const getEmployeeDashboardData = async (req, res) => {
  try {
    const employeeId = req.user.id;
    const companyId = req.user.company_id;

    if (!companyId) {
      return res
        .status(400)
        .json({ message: "You are not assigned to any company" });
    }

    const today = getDateKey();
    const { month: currentMonth, year: currentYear } = getZonedDateParts();

    // Get every attendance session for today. The first punch owns the day's
    // status (late/half-day is decided at first check-in), while later rows may
    // only be post-break continuation sessions.
    const todayAttendanceRows = await knex("attendance")
      .where({
        company_id: companyId,
        employee_id: employeeId,
      })
      .whereRaw("DATE(check_in) = ?", [today])
      .orderBy("check_in", "asc");

    const todayAttendance = todayAttendanceRows[0] || null;
    const latestAttendance = todayAttendanceRows.length
      ? todayAttendanceRows[todayAttendanceRows.length - 1]
      : null;

    // Approved leave takes precedence over an unmarked day so employees on
    // leave are not shown as absent/not marked.
    const todayLeave = await knex("leave_applications")
      .where({
        company_id: companyId,
        employee_id: employeeId,
        status: "approved",
      })
      .whereRaw("? BETWEEN from_date AND to_date", [today])
      .orderBy("approved_at", "desc")
      .first();

    const normalizedTodayStatus = String(todayAttendance?.status || "")
      .trim()
      .toLowerCase();
    const attendanceStatusLabels = {
      present: "Present",
      late: "Late",
      grace: "Grace",
      half_day: "Half Day",
      absent: "Absent",
    };
    const todayStatusLabel = todayLeave
      ? "Leave"
      : attendanceStatusLabels[normalizedTodayStatus] || "Not Marked";
    const activityTime = latestAttendance
      ? latestAttendance.check_out || latestAttendance.check_in
      : null;
    const formattedActivityTime = activityTime
      ? formatTime(activityTime, { locale: "en-US" })
      : null;

    // Get leave balance
    await assignLeaveBalancesForEmployee(employeeId, companyId, {
      requireActive: true,
      asOfDate: new Date(),
    });
    const employeeProfile = await knex("employees")
      .where({ id: employeeId, company_id: companyId })
      .select("id", "gender")
      .first();
    const eligiblePaidLeaveBalances = await knex("leave_balances as lb")
      .join("leave_types as lt", "lb.leave_type_id", "lt.id")
      .where({
        "lb.company_id": companyId,
        "lb.employee_id": employeeId,
        "lb.year": currentYear,
        "lt.status": "active",
      })
      .where("lt.annual_limit", ">", 0)
      .where((builder) => {
        builder
          .where("lt.is_paid", true)
          .orWhere("lt.is_paid", 1)
          .orWhere("lt.is_paid", "1");
      })
      .select("lb.available", "lt.name as leave_type_name");
    const totalEligibleLeaveBalance = eligiblePaidLeaveBalances
      .filter((balance) =>
        isLeaveTypeEligibleForEmployee(balance, employeeProfile),
      )
      .reduce((total, balance) => total + Number(balance.available || 0), 0);

    // Get monthly permission balance from company policy
    const policy = await getCompanyPolicy(companyId);
    const permissionLimit = policy.permission.enabled
      ? Number(policy.permission.maxPerMonth || 0)
      : 0;
    const permissionStatuses = policy.permission.includePendingInUsage
      ? ["pending", "approved"]
      : ["approved"];
    const permissionRows = permissionLimit
      ? await knex("leave_permissions")
          .where({
            company_id: companyId,
            employee_id: employeeId,
          })
          .whereIn("status", permissionStatuses)
          .whereRaw(
            "MONTH(permission_date) = ? AND YEAR(permission_date) = ?",
            [currentMonth, currentYear],
          )
          .select("permission_time_from", "permission_time_to")
      : [];
    const hoursPerPermission =
      Number(policy.permission.hoursPerPermission || 1) || 1;
    const usedPermissionUnits = permissionRows.reduce(
      (total, permission) =>
        total +
        getPermissionUnits(
          permission.permission_time_from,
          permission.permission_time_to,
          hoursPerPermission,
        ),
      0,
    );

    // Get working hours today
    const workingHours = await knex("attendance")
      .where({
        company_id: companyId,
        employee_id: employeeId,
      })
      .whereRaw("DATE(check_in) = ?", [today])
      .whereNotNull("check_out")
      .select("check_in", "check_out")
      .orderBy("check_out", "desc")
      .orderBy("check_in", "desc")
      .first();

    let hoursWorked = 0;
    if (workingHours && workingHours.check_in && workingHours.check_out) {
      const checkIn = new Date(workingHours.check_in);
      const checkOut = new Date(workingHours.check_out);
      hoursWorked = ((checkOut - checkIn) / (1000 * 60 * 60)).toFixed(1);
    }

    // Get monthly attendance data
    const monthlyAttendance = await knex("attendance")
      .where({
        company_id: companyId,
        employee_id: employeeId,
      })
      .whereRaw("MONTH(check_in) = ? AND YEAR(check_in) = ?", [
        currentMonth,
        currentYear,
      ])
      .select(
        knex.raw("DATE(check_in) as date"),
        "status",
        "check_in",
        "check_out",
      )
      .orderBy("check_in");

    // Format monthly attendance for chart
    const attendanceChartData = monthlyAttendance.map((day) => ({
      date: new Date(day.date).getDate(),
      present: day.status === "present" || day.status === "late" ? 1 : 0,
      absent: day.status === "absent" ? 1 : 0,
      half: day.status === "half_day" ? 1 : 0,
    }));

    // Calculate monthly summary
    const presentDays = monthlyAttendance.filter(
      (a) => a.status === "present" || a.status === "late",
    ).length;
    const absentDays = monthlyAttendance.filter(
      (a) => a.status === "absent",
    ).length;
    const halfDays = monthlyAttendance.filter(
      (a) => a.status === "half_day",
    ).length;

    const dashboardData = {
      todayStatus: {
        status: todayStatusLabel,
        checkInTime: formattedActivityTime,
        description: todayLeave
          ? `Approved ${todayLeave.leave_type_name || "leave"}`
          : latestAttendance
            ? `${latestAttendance.check_out ? "Last checked out" : "Checked in"} at ${formattedActivityTime}`
            : "Attendance not marked",
      },
      leaveBalance: {
        totalDays: totalEligibleLeaveBalance,
        description: "Days remaining this year",
      },
      permissionBalance: {
        remaining: Math.max(permissionLimit - usedPermissionUnits, 0),
        used: usedPermissionUnits,
        limit: permissionLimit,
        description: permissionLimit
          ? `${usedPermissionUnits}/${permissionLimit} used this month`
          : "No monthly permission limit configured",
      },
      workingHours: {
        hours: hoursWorked || "0",
        description: "Hours logged today",
      },
      monthlyAttendance: {
        chartData: attendanceChartData,
        summary: {
          present: presentDays,
          absent: absentDays,
          half: halfDays,
          total: presentDays + absentDays + halfDays,
        },
      },
    };

    res.status(200).json(dashboardData);
  } catch (error) {
    console.error("Employee dashboard data error:", error);
    res.status(500).json({
      message: "Failed to fetch employee dashboard data",
      error: error.message,
    });
  }
};

// const getManagerDashboardData = async (req, res) => {
//   try {
//     const companyId = req.user.company_id;
//     const managerId = req.user.id;

//     if (!companyId) {
//       return res.status(400).json({ message: 'You are not assigned to any company' });
//     }

//     // ===============================
//     // 1️⃣ Get Manager Department
//     // ===============================
//     const manager = await knex('employees')
//       .where({ id: managerId, company_id: companyId })
//       .first();

//     if (!manager || !manager.department_id) {
//       return res.status(400).json({ message: 'Manager department not found' });
//     }

//     const departmentId = manager.department_id;

//     // ===============================
//     // 2️⃣ Total Employees (Department)
//     // ===============================
//     const totalEmployeesResult = await knex('employees')
//       .where('company_id', companyId)
//       .where('department_id', departmentId)
//       .count('* as count')
//       .first();

//     const totalEmployees = Number(totalEmployeesResult?.count || 0);

//     // ===============================
//     // 3️⃣ Pending Leaves (Department)
//     // ===============================
//     const pendingLeavesResult = await knex('leave_applications as la')
//       .join('employees as e', 'la.employee_id', 'e.id')
//       .where('la.company_id', companyId)
//       .where('e.department_id', departmentId)
//       .where('la.status', 'pending')
//       .count('* as count')
//       .first();

//     const pendingLeaves = Number(pendingLeavesResult?.count || 0);

//     // ===============================
//     // 4️⃣ Pending Expenses (Department)
//     // ===============================
//     const pendingExpensesResult = await knex('expenses as ex')
//       .join('employees as e', 'ex.employee_id', 'e.id')
//       .where('ex.company_id', companyId)
//       .where('e.department_id', departmentId)
//       .where('ex.status', 'Pending')
//       .count('* as count')
//       .first();

//     const pendingExpenses = Number(pendingExpensesResult?.count || 0);

//     // ===============================
//     // 5️⃣ New Joinees This Month (Department)
//     // ===============================
//     const newJoineesResult = await knex('employees')
//       .where('company_id', companyId)
//       .where('department_id', departmentId)
//       .whereRaw('MONTH(created_at) = MONTH(CURDATE())')
//       .whereRaw('YEAR(created_at) = YEAR(CURDATE())')
//       .count('* as count')
//       .first();

//     const newJoinees = Number(newJoineesResult?.count || 0);

//     // ===============================
//     // 6️⃣ Present Today (FIXED)
//     // ===============================
//     const presentTodayResult = await knex('attendance as a')
//       .join('employees as e', 'a.employee_id', 'e.id')
//       .where('a.company_id', companyId)
//       .where('e.department_id', departmentId)
//       .whereNotNull('a.check_in')
//       .whereRaw('DATE(a.check_in) = CURDATE()') // ✅ FIXED
//       .where('a.status', 'present')
//       .countDistinct('a.employee_id as count')
//       .first();

//     const presentToday = Number(presentTodayResult?.count || 0);

//     // ===============================
//     // 7️⃣ On Leave Today (Approved)
//     // ===============================
//     const onLeaveTodayResult = await knex('leave_applications as la')
//       .join('employees as e', 'la.employee_id', 'e.id')
//       .where('la.company_id', companyId)
//       .where('e.department_id', departmentId)
//       .where('la.status', 'approved')
//       .whereRaw('CURDATE() BETWEEN la.from_date AND la.to_date')
//       .countDistinct('la.employee_id as count')
//       .first();

//     const onLeaveToday = Number(onLeaveTodayResult?.count || 0);

//     // ===============================
//     // 8️⃣ Department Employees List
//     // ===============================
//     const employees = await knex('employees')
//       .select('id', 'employee_id', 'first_name', 'last_name', 'email', 'designation_id', 'status')
//       .where('company_id', companyId)
//       .where('department_id', departmentId);

//     // ===============================
//     // 9️⃣ Department Leaves List
//     // ===============================
//     const leaves = await knex('leave_applications as la')
//       .join('employees as e', 'la.employee_id', 'e.id')
//       .select(
//         'la.id',
//         'la.from_date',
//         'la.to_date',
//         'la.status',
//         'la.reason',
//         'e.first_name',
//         'e.last_name',
//         'e.employee_id'
//       )
//       .where('la.company_id', companyId)
//       .where('e.department_id', departmentId)
//       .orderBy('la.created_at', 'desc');

//     // ===============================
//     // 🔟 Department Expenses List
//     // ===============================
//     const expenses = await knex('expenses as ex')
//       .join('employees as e', 'ex.employee_id', 'e.id')
//       .select(
//         'ex.id',
//         'ex.expense_id',
//         'ex.amount',
//         'ex.status',
//         'ex.created_at',
//         'e.first_name',
//         'e.last_name',
//         'e.employee_id'
//       )
//       .where('ex.company_id', companyId)
//       .where('e.department_id', departmentId)
//       .orderBy('ex.created_at', 'desc');

//     // ===============================
//     // ✅ FINAL RESPONSE
//     // ===============================
//     res.status(200).json({
//       managerStats: {
//         totalEmployees,
//         pendingLeaves,
//         pendingExpenses,
//         newJoinees,
//         presentToday,     // ✅ FIXED
//         onLeaveToday      // ✅ FIXED
//       },
//       departmentInfo: {
//         department_id: departmentId
//       },
//       employees,
//       leaves,
//       expenses
//     });

//   } catch (error) {
//     console.error('Manager dashboard data error:', error);
//     res.status(500).json({
//       message: 'Failed to fetch manager dashboard data',
//       error: error.message
//     });
//   }
// };

const getManagerDashboardData = async (req, res) => {
  try {
    const companyId = req.user.company_id;
    const managerId = req.user.id;

    if (!companyId) {
      return res
        .status(400)
        .json({ message: "You are not assigned to any company" });
    }

    // ===============================
    // 1️⃣ Get Manager Department
    // ===============================
    const manager = await knex("employees")
      .where({ id: managerId, company_id: companyId })
      .first();

    if (!manager || !manager.department_id) {
      return res.status(400).json({ message: "Manager department not found" });
    }

    const departmentId = manager.department_id;

    // ===============================
    // 2️⃣ Total Employees (Department)
    // ===============================
    const totalEmployeesResult = await knex("employees")
      .where("company_id", companyId)
      .where("department_id", departmentId)
      .where("status", "active")
      .count("* as count")
      .first();

    const totalEmployees = Number(totalEmployeesResult?.count || 0);

    // ===============================
    // 3️⃣ Pending Leaves (Department)
    // ===============================
    const pendingLeavesResult = await knex("leave_applications as la")
      .join("employees as e", "la.employee_id", "e.id")
      .where("la.company_id", companyId)
      .where("e.department_id", departmentId)
      .where("la.status", "pending")
      .count("* as count")
      .first();

    const pendingLeaves = Number(pendingLeavesResult?.count || 0);

    // ===============================
    // 4️⃣ Pending Expenses (Department)
    // ===============================
    const pendingExpensesResult = await knex("expenses as ex")
      .join("employees as e", "ex.employee_id", "e.id")
      .where("ex.company_id", companyId)
      .where("e.department_id", departmentId)
      .where("ex.status", "Pending")
      .count("* as count")
      .first();

    const pendingExpenses = Number(pendingExpensesResult?.count || 0);

    // ===============================
    // 5️⃣ New Joinees This Month (Department)
    // ===============================
    const newJoineesResult = await knex("employees")
      .where("company_id", companyId)
      .where("department_id", departmentId)
      .where("status", "active")
      .whereRaw("MONTH(created_at) = MONTH(CURDATE())")
      .whereRaw("YEAR(created_at) = YEAR(CURDATE())")
      .count("* as count")
      .first();

    const newJoinees = Number(newJoineesResult?.count || 0);

    // ===============================
    // 6️⃣ Present Today
    // ===============================
    const presentTodayResult = await knex("attendance as a")
      .join("employees as e", "a.employee_id", "e.id")
      .where("a.company_id", companyId)
      .where("e.department_id", departmentId)
      .whereNotNull("a.check_in")
      .whereRaw("DATE(a.check_in) = CURDATE()")
      .whereIn("a.status", ["present", "late"])
      .countDistinct("a.employee_id as count")
      .first();

    const presentToday = Number(presentTodayResult?.count || 0);

    // ===============================
    // 7️⃣ On Leave Today
    // ===============================
    const onLeaveTodayResult = await knex("leave_applications as la")
      .join("employees as e", "la.employee_id", "e.id")
      .where("la.company_id", companyId)
      .where("e.department_id", departmentId)
      .where("la.status", "approved")
      .whereRaw("CURDATE() BETWEEN la.from_date AND la.to_date")
      .countDistinct("la.employee_id as count")
      .first();

    const onLeaveToday = Number(onLeaveTodayResult?.count || 0);

    // ===============================
    // 🆕 11️⃣ Monthly Attendance Summary (Department)
    // ===============================
    const monthlyAttendanceSummary = await knex("attendance as a")
      .join("employees as e", "a.employee_id", "e.id")
      .where("a.company_id", companyId)
      .where("e.department_id", departmentId)
      .whereRaw("MONTH(a.check_in) = MONTH(CURDATE())")
      .whereRaw("YEAR(a.check_in) = YEAR(CURDATE())")
      .select(
        knex.raw(
          "SUM(CASE WHEN a.status = 'present' OR a.status = 'late' THEN 1 ELSE 0 END) as present_count",
        ),
        knex.raw(
          "SUM(CASE WHEN a.status = 'absent' THEN 1 ELSE 0 END) as absent_count",
        ),
        knex.raw("COUNT(a.id) as total_records"),
      )
      .first();

    const monthlyAttendance = {
      present: Number(monthlyAttendanceSummary?.present_count || 0),
      absent: Number(monthlyAttendanceSummary?.absent_count || 0),
      totalRecords: Number(monthlyAttendanceSummary?.total_records || 0),
    };

    // ===============================
    // 🆕 12️⃣ Monthly Attendance By Employee (For Charts / Table)
    // ===============================
    const monthlyAttendanceByEmployee = await knex("attendance as a")
      .join("employees as e", "a.employee_id", "e.id")
      .where("a.company_id", companyId)
      .where("e.department_id", departmentId)
      .whereRaw("MONTH(a.check_in) = MONTH(CURDATE())")
      .whereRaw("YEAR(a.check_in) = YEAR(CURDATE())")
      .groupBy("a.employee_id")
      .select(
        "a.employee_id",
        "e.first_name",
        "e.last_name",
        knex.raw(
          "SUM(CASE WHEN a.status = 'present' OR a.status = 'late' THEN 1 ELSE 0 END) as present_days",
        ),
        knex.raw(
          "SUM(CASE WHEN a.status = 'absent' THEN 1 ELSE 0 END) as absent_days",
        ),
        knex.raw("COUNT(a.id) as total_days"),
      );

    // ===============================
    // 8️⃣ Department Employees List
    // ===============================
    const employees = await knex("employees")
      .select(
        "id",
        "employee_id",
        "first_name",
        "last_name",
        "email",
        "designation_id",
        "status",
      )
      .where("company_id", companyId)
      .where("department_id", departmentId);

    // ===============================
    // 9️⃣ Department Leaves List
    // ===============================
    const leaves = await knex("leave_applications as la")
      .join("employees as e", "la.employee_id", "e.id")
      .select(
        "la.id",
        "la.from_date",
        "la.to_date",
        "la.status",
        "la.reason",
        "e.first_name",
        "e.last_name",
        "e.employee_id",
      )
      .where("la.company_id", companyId)
      .where("e.department_id", departmentId)
      .orderBy("la.created_at", "desc");

    // ===============================
    // 🔟 Department Expenses List
    // ===============================
    const expenses = await knex("expenses as ex")
      .join("employees as e", "ex.employee_id", "e.id")
      .select(
        "ex.id",
        "ex.expense_id",
        "ex.amount",
        "ex.status",
        "ex.created_at",
        "e.first_name",
        "e.last_name",
        "e.employee_id",
      )
      .where("ex.company_id", companyId)
      .where("e.department_id", departmentId)
      .orderBy("ex.created_at", "desc");

    // ===============================
    // ✅ FINAL RESPONSE (WITH MONTHLY ATTENDANCE)
    // ===============================
    res.status(200).json({
      managerStats: {
        totalEmployees,
        pendingLeaves,
        pendingExpenses,
        newJoinees,
        presentToday,
        onLeaveToday,
      },
      monthlyAttendance, // 🆕 SUMMARY
      monthlyAttendanceByEmployee, // 🆕 PER EMPLOYEE
      departmentInfo: {
        department_id: departmentId,
      },
      employees,
      leaves,
      expenses,
    });
  } catch (error) {
    console.error("Manager dashboard data error:", error);
    res.status(500).json({
      message: "Failed to fetch manager dashboard data",
      error: error.message,
    });
  }
};

const getHRDashboardData = async (req, res) => {
  try {
    const companyId = req.user.company_id;

    if (!companyId) {
      return res
        .status(400)
        .json({ message: "You are not assigned to any company" });
    }

    const today = getDateKey();
    const { month: currentMonth, year: currentYear } = getZonedDateParts();

    // Get total employees
    const totalEmployeesResult = await knex("employees")
      .where({ company_id: companyId, status: "active" })
      .count("* as count")
      .first();
    const totalEmployees = Number(totalEmployeesResult?.count || 0);

    // Get pending resignations
    const pendingResignations = await knex("resignations")
      .where({ company_id: companyId, approval_status: "pending" })
      .count("* as count")
      .first();
    const pendingExits = Number(pendingResignations?.count || 0);

    // Get pending leave applications (for HR approval)
    const pendingLeaveApplications = await knex("leave_applications")
      .where({ company_id: companyId, status: "pending" })
      .count("* as count")
      .first();
    const pendingLeaveCount = Number(pendingLeaveApplications?.count || 0);

    // Get new joiners this month
    const newJoinersResult = await knex("employees")
      .where({ company_id: companyId, status: "active" })
      .whereRaw("MONTH(doj) = ? AND YEAR(doj) = ?", [currentMonth, currentYear])
      .count("* as count")
      .first();
    const newJoiners = Number(newJoinersResult?.count || 0);

    // Get department-wise headcount
    const departmentData = await knex("employees as e")
      .leftJoin("departments as d", "e.department_id", "d.id")
      .where("e.company_id", companyId)
      .where("e.status", "active")
      .select("d.name as dept")
      .count("e.id as count")
      .groupBy("d.name")
      .orderBy("count", "desc");

    const departmentChartData = departmentData
      .filter((d) => d.dept !== null)
      .map((d) => ({
        dept: d.dept || "Unassigned",
        count: Number(d.count),
      }));

    const dashboardData = {
      hrStats: {
        totalEmployees,
        pendingExits,
        pendingLeaveApprovals: pendingLeaveCount,
        newJoiners,
      },
      departmentData: departmentChartData,
    };

    res.status(200).json(dashboardData);
  } catch (error) {
    console.error("HR dashboard data error:", error);
    res.status(500).json({
      message: "Failed to fetch HR dashboard data",
      error: error.message,
    });
  }
};

const getFinanceDashboardData = async (req, res) => {
  try {
    const companyId = req.user.company_id;

    if (!companyId) {
      return res
        .status(400)
        .json({ message: "You are not assigned to any company" });
    }

    const { month: currentMonth, year: currentYear } = getZonedDateParts();

    console.log(
      `Fetching data for companyId: ${companyId}, Year: ${currentYear}, Month: ${currentMonth}`,
    );
    console.log(
      `Month filter: ${currentYear}-${currentMonth.toString().padStart(2, "0")}`,
    );

    // Fix existing payroll data with corrected calculation
    const existingPayroll = await knex("payroll_processing")
      .where({ company_id: companyId })
      .whereRaw("month = ?", [
        `${currentYear}-${currentMonth.toString().padStart(2, "0")}`,
      ]);

    for (const payroll of existingPayroll) {
      const correctedNet = payroll.gross - payroll.deductions;
      await knex("payroll_processing")
        .where({ id: payroll.id })
        .update({ net: correctedNet > 0 ? correctedNet : 0 });
    }

    // Get monthly payroll total
    const monthlyPayrollResult = await knex("payroll_processing")
      .where({ company_id: companyId })
      .whereRaw("month = ?", [
        `${currentYear}-${currentMonth.toString().padStart(2, "0")}`,
      ])
      .sum("net as total")
      .first();
    console.log("monthlyPayrollResult:", monthlyPayrollResult);
    const monthlyPayroll = Number(monthlyPayrollResult?.total || 0);

    // Get pending expense claims
    const pendingExpensesResult = await knex("expenses")
      .where({ company_id: companyId, status: "pending" })
      .sum("amount as total")
      .first();
    const pendingExpenses = Number(pendingExpensesResult?.total || 0);

    // Get payslips generated this month
    const payslipsGeneratedResult = await knex("payroll_processing")
      .where({ company_id: companyId })
      .whereRaw("month = ?", [
        `${currentYear}-${currentMonth.toString().padStart(2, "0")}`,
      ])
      .count("* as count")
      .first();
    console.log("payslipsGeneratedResult:", payslipsGeneratedResult);
    const payslipsGenerated = Number(payslipsGeneratedResult?.count || 0);

    // Get budget utilization (simplified calculation)
    const annualBudget = 5000000; // This should come from a budget table
    const ytdPayrollResult = await knex("payroll_processing")
      .where({ company_id: companyId })
      .whereRaw("YEAR(created_at) = ?", [currentYear])
      .sum("net as total")
      .first();
    const ytdPayroll = Number(ytdPayrollResult?.total || 0);
    const budgetUtilization = Math.round((ytdPayroll / annualBudget) * 100);

    // Get monthly payroll trend for the last 6 months
    const payrollTrend = await knex("payroll_processing")
      .where({ company_id: companyId })
      .whereRaw("created_at >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH)")
      .select(
        knex.raw('DATE_FORMAT(created_at, "%b") as month'),
        knex.raw("COUNT(*) as employees"),
        knex.raw("SUM(net) as total"),
      )
      .groupByRaw('DATE_FORMAT(created_at, "%b-%Y")')
      .orderByRaw("MIN(created_at)");

    const payrollChartData = payrollTrend.map((item) => ({
      month: item.month,
      present: Number(item.employees),
      total: Number(item.total),
    }));

    const dashboardData = {
      financeStats: {
        monthlyPayroll:
          monthlyPayroll !== 0
            ? `₹${monthlyPayroll.toLocaleString("en-IN")}`
            : "₹0",
        pendingExpenses:
          pendingExpenses > 0
            ? `₹${pendingExpenses.toLocaleString("en-IN")}`
            : "₹0",
        payslipsGenerated,
        budgetUtilization: `${budgetUtilization}%`,
      },
      payrollTrend: payrollChartData,
    };

    console.log("Final dashboard data:", dashboardData);
    console.log("Raw monthlyPayroll:", monthlyPayroll);
    console.log("Raw payslipsGenerated:", payslipsGenerated);

    res.status(200).json(dashboardData);
  } catch (error) {
    console.error("Finance dashboard data error:", error);
    res.status(500).json({
      message: "Failed to fetch finance dashboard data",
      error: error.message,
    });
  }
};

const getEmployeeAnalyticsData = async (req, res) => {
  try {
    const companyId = Number(req.user?.company_id);
    if (!companyId) {
      return res
        .status(400)
        .json({ message: "You are not assigned to any company" });
    }

    const employeeId = await resolveEmployeeIdFromUser(req);
    if (!employeeId) {
      return res
        .status(404)
        .json({ message: "Employee profile not found for this account" });
    }

    const period = String(req.query?.period || "6months");
    const monthBuckets = monthsForPeriod(period);
    const firstMonth = monthBuckets[0];
    const lastMonth = monthBuckets[monthBuckets.length - 1];
    const rangeStart = new Date(
      firstMonth.year,
      firstMonth.month - 1,
      1,
      0,
      0,
      0,
      0,
    );
    const rangeEnd = new Date(
      lastMonth.year,
      lastMonth.month,
      0,
      23,
      59,
      59,
      999,
    );

    const attendanceRows = await knex("attendance")
      .where({
        company_id: companyId,
        employee_id: employeeId,
      })
      .whereBetween("check_in", [
        rangeStart.toISOString(),
        rangeEnd.toISOString(),
      ])
      .select("check_in", "status", "hours_worked");

    const attendanceByMonth = {};
    const monthlyHours = {};
    monthBuckets.forEach((m) => {
      attendanceByMonth[m.key] = { present: 0, absent: 0, late: 0, halfDay: 0 };
      monthlyHours[m.key] = 0;
    });

    for (const row of attendanceRows) {
      const dt = new Date(row.check_in);
      if (Number.isNaN(dt.getTime())) continue;
      const monthKey = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
      if (!attendanceByMonth[monthKey]) continue;
      const s = String(row.status || "")
        .toLowerCase()
        .trim();

      if (s === "present") attendanceByMonth[monthKey].present += 1;
      else if (s === "late") attendanceByMonth[monthKey].late += 1;
      else if (s === "half_day" || s === "half-day" || s === "half")
        attendanceByMonth[monthKey].halfDay += 1;
      else if (s === "absent") attendanceByMonth[monthKey].absent += 1;

      monthlyHours[monthKey] += Number(row.hours_worked || 0);
    }

    const monthlyAttendanceData = monthBuckets.map((m) => ({
      month: m.short,
      ...attendanceByMonth[m.key],
    }));

    const performanceData = monthBuckets.map((m) => {
      const bucket = attendanceByMonth[m.key];
      const total =
        bucket.present + bucket.late + bucket.halfDay + bucket.absent;
      const score =
        total > 0
          ? Math.round(
              ((bucket.present + bucket.late + bucket.halfDay * 0.5) / total) *
                100,
            )
          : 0;
      return { month: m.short, score, target: 90 };
    });

    const currentDateParts = getZonedDateParts();
    const currentMonthKey = `${currentDateParts.year}-${String(currentDateParts.month).padStart(2, "0")}`;
    const currentMonth = attendanceByMonth[currentMonthKey] || {
      present: 0,
      absent: 0,
      late: 0,
      halfDay: 0,
    };
    const currentMonthTotal =
      currentMonth.present +
      currentMonth.absent +
      currentMonth.late +
      currentMonth.halfDay;
    const attendanceRate =
      currentMonthTotal > 0
        ? Number(
            (
              ((currentMonth.present +
                currentMonth.late +
                currentMonth.halfDay * 0.5) /
                currentMonthTotal) *
              100
            ).toFixed(1),
          )
        : 0;

    const leaveBalanceRows = await knex("leave_balances as lb")
      .leftJoin("leave_types as lt", "lb.leave_type_id", "lt.id")
      .where({
        "lb.company_id": companyId,
        "lb.employee_id": employeeId,
        "lb.year": currentDateParts.year,
      })
      .select("lt.name as leave_type_name", "lb.available", "lb.availed");

    const leaveData = [];
    let totalLeaveAvailable = 0;
    let totalLeaveAvailed = 0;
    for (const row of leaveBalanceRows) {
      const availed = Number(row.availed || 0);
      const available = Number(row.available || 0);
      totalLeaveAvailed += availed;
      totalLeaveAvailable += available;
      leaveData.push({
        name: row.leave_type_name || "Leave",
        value: available,
      });
    }
    leaveData.push({ name: "Used", value: totalLeaveAvailed });

    const goals = [
      {
        title: "Achieve 95% attendance",
        progress: Math.min(100, Math.max(0, attendanceRate)),
        current: `${attendanceRate}%`,
        target: "95%",
      },
      {
        title: "Minimize late arrivals",
        progress:
          currentMonthTotal > 0
            ? Math.max(
                0,
                100 - Math.round((currentMonth.late / currentMonthTotal) * 100),
              )
            : 100,
        current: `${currentMonth.late}`,
        target: "0",
      },
      {
        title: "Maintain working hours",
        progress: Math.min(
          100,
          Math.round((Number(monthlyHours[currentMonthKey] || 0) / 160) * 100),
        ),
        current: `${Number(monthlyHours[currentMonthKey] || 0).toFixed(1)}h`,
        target: "160h",
      },
    ];

    const analytics = {
      summary: {
        attendanceRate,
        performanceScore: performanceData.length
          ? performanceData[performanceData.length - 1].score
          : 0,
        workingHoursMonth: Number(monthlyHours[currentMonthKey] || 0).toFixed(
          1,
        ),
        leaveAvailable: totalLeaveAvailable,
        presentDays: currentMonth.present,
        lateDays: currentMonth.late,
        halfDays: currentMonth.halfDay,
        absentDays: currentMonth.absent,
      },
      charts: {
        monthlyAttendanceData,
        performanceData,
        leaveData,
      },
      goals,
    };

    return res.status(200).json(analytics);
  } catch (error) {
    console.error("Employee analytics data error:", error);
    return res.status(500).json({
      message: "Failed to fetch employee analytics data",
      error: error.message,
    });
  }
};

module.exports = {
  getAdminDashboardData,
  getEmployeeDashboardData,
  getManagerDashboardData,
  getHRDashboardData,
  getFinanceDashboardData,
  getEmployeeAnalyticsData,
};
