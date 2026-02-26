// src/controllers/adminDashboardController.js
const knex = require('../db/db'); // Adjust path if needed

const getRelativeTime = (dateString) => {
  if (!dateString) return 'Unknown time';
  const now = new Date();
  const target = new Date(dateString);
  const diffMs = now.getTime() - target.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);
  const diffDays = diffMs / (1000 * 60 * 60 * 24);

  if (diffMs < 0) return 'In the future';
  if (diffHours < 1) return 'Just now';
  if (diffHours < 24) return `${Math.round(diffHours)} hour${diffHours > 1 ? 's' : ''} ago`;
  if (diffDays < 7) return `${Math.round(diffDays)} day${diffDays > 1 ? 's' : ''} ago`;
  return 'Older';
};

const getAdminDashboardData = async (req, res) => {
  try {
    const companyId = req.user.company_id;

    if (!companyId) {
      return res.status(400).json({ message: 'You are not assigned to any company' });
    }

    const today = new Date().toISOString().split('T')[0];
    const yesterday = new Date(Date.now() - 86400000);
    const yesterdayStr = yesterday.toISOString().split('T')[0];

    // ==================== Base Data ====================
    const totalEmployeesResult = await knex('employees')
      .where({ company_id: companyId, status: 'active' })
      .count('* as count')
      .first();
    const totalEmployees = Number(totalEmployeesResult?.count || 0);

    const attendanceTodayRaw = await knex('attendance')
      .where({ company_id: companyId })
      .whereRaw('DATE(check_in) = ?', [today]);

    const presentToday = attendanceTodayRaw.filter(a =>
      ['present', 'late'].includes(String(a.status || '').toLowerCase().trim())
    ).length;
    const totalAttendanceToday = attendanceTodayRaw.length;
    const flaggedToday = attendanceTodayRaw.filter(a => a.auto_flag === 1).length;

    const presentYesterdayResult = await knex('attendance')
      .where({ company_id: companyId })
      .whereRaw('DATE(check_in) = ?', [yesterdayStr])
      .whereRaw("LOWER(TRIM(status)) IN ('present','late')")
      .count('* as count')
      .first();
    const presentYesterday = Number(presentYesterdayResult?.count || 0);

    const onLeave = await knex('leave_applications')
      .where({ company_id: companyId, status: 'approved' })
      .whereRaw(`? BETWEEN from_date AND to_date`, [today])
      .countDistinct('employee_id as count')
      .first()
      .then(r => Number(r?.count || 0));

    const pendingApprovals = await knex('leave_applications')
      .where({ company_id: companyId, status: 'pending' })
      .count('* as count')
      .first()
      .then(r => Number(r?.count || 0));

    const leaveUtilization = await knex('leave_balances')
      .where({ company_id: companyId })
      .select(
        knex.raw('SUM(availed) as used'),
        knex.raw('SUM(availed + available) as total')
      )
      .first();

    const usedLeave = Number(leaveUtilization?.used || 0);
    const totalLeave = Number(leaveUtilization?.total || usedLeave || 1);
    const remainingLeave = totalLeave - usedLeave;
    const leaveBalanceHealth = Math.round((remainingLeave / totalLeave) * 100);

    const leaveData = [
      { name: 'Used', value: usedLeave, fill: '#ef4444' },
      { name: 'Remaining', value: remainingLeave, fill: '#10b981' },
    ];

    // ==================== Dynamic Metrics ====================
    const attendanceScore = totalEmployees > 0 ? Math.round((presentToday / totalEmployees) * 100) : 0;
    const previousAttendanceScore = totalEmployees > 0 ? Math.round((presentYesterday / totalEmployees) * 100) : attendanceScore;

    const trendValue = attendanceScore - previousAttendanceScore;
    const trend = trendValue > 0
      ? `↑ ${trendValue}%`
      : trendValue < 0
        ? `↓ ${Math.abs(trendValue)}%`
        : 'No change';

    const payrollValue = 100;

    const complianceScore = totalAttendanceToday > 0
      ? Math.round(100 - (flaggedToday / totalAttendanceToday * 100))
      : 100;

    const overallScore = Math.round(
      (attendanceScore + leaveBalanceHealth + payrollValue + complianceScore) / 4
    );

    const status = overallScore >= 85
      ? 'Excellent Health'
      : overallScore >= 70
        ? 'Good Health Status'
        : 'Needs Attention';

    // ==================== Strengths & Improvements ====================
    const strengths = [];
    const improvements = [];

    strengths.push('Payroll processing 100% on schedule');

    if (complianceScore >= 95) {
      strengths.push('Excellent compliance – minimal/no flagged records');
    } else if (complianceScore >= 80) {
      strengths.push(`Good compliance (${complianceScore}%)`);
    } else {
      improvements.push(`Compliance needs review (${complianceScore}%) – ${flaggedToday} flagged record${flaggedToday > 1 ? 's' : ''} today`);
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
      improvements.push(`Leave balance health low (${leaveBalanceHealth}%) – encourage leave taking`);
    }

    if (pendingApprovals === 0) {
      strengths.push('All leave requests processed promptly');
    } else {
      improvements.push(`${pendingApprovals} pending leave approval${pendingApprovals > 1 ? 's' : ''}`);
    }

    const teamHealth = {
      overallScore,
      status,
      trend,
      lastUpdated: 'Today',
      metrics: [
        {
          label: 'Attendance Score',
          value: attendanceScore,
          color: attendanceScore >= 90 ? 'bg-green-500' : attendanceScore >= 70 ? 'bg-yellow-500' : 'bg-red-500',
        },
        {
          label: 'Leave Balance Health',
          value: leaveBalanceHealth,
          color: leaveBalanceHealth >= 80 ? 'bg-green-500' : leaveBalanceHealth >= 60 ? 'bg-yellow-500' : 'bg-red-500',
        },
        {
          label: 'Payroll Status',
          value: payrollValue,
          color: 'bg-green-500',
        },
        {
          label: 'Compliance Score',
          value: complianceScore,
          color: complianceScore >= 90 ? 'bg-green-500' : complianceScore >= 70 ? 'bg-yellow-500' : 'bg-red-500',
        },
      ],
      strengths,
      improvements,
    };

    // ==================== Recent Activities ====================
    const activities = [];

    const recentApprovedLeaves = await knex('leave_applications')
      .where({ company_id: companyId, status: 'approved' })
      .select('employee_name', 'leave_type_name', 'approved_at')
      .orderBy('approved_at', 'desc')
      .limit(10);

    recentApprovedLeaves.forEach(leave => {
      if (leave.approved_at) {
        activities.push({
          activity: `${leave.leave_type_name || 'Leave'} approved for ${leave.employee_name}`,
          time: getRelativeTime(leave.approved_at),
          icon: '✓',
          timestamp: new Date(leave.approved_at).getTime(),
        });
      }
    });

    // Recent Joinings with Department Name Join
    const recentJoiningsRaw = await knex('employees as e')
      .leftJoin('departments as d', 'e.department_id', 'd.id')
      .where('e.company_id', companyId)
      .where('e.status', 'active')
      .select(
        'e.first_name',
        'e.last_name',
        'e.role',
        'e.doj as join_date',
        'd.name as dept_name'
      )
      .orderBy('e.doj', 'desc')
      .limit(10);

    recentJoiningsRaw.forEach(emp => {
      if (emp.join_date) {
        activities.push({
          activity: `New employee onboarded: ${emp.first_name} ${emp.last_name}${emp.role ? ` (${emp.role})` : ''}`,
          time: getRelativeTime(emp.join_date),
          icon: '👤',
          timestamp: new Date(emp.join_date).getTime(),
        });
      }
    });

    activities.sort((a, b) => b.timestamp - a.timestamp);
    let recentActivities = activities.slice(0, 5).map(({ timestamp, ...rest }) => rest);

    if (recentActivities.length === 0) {
      recentActivities = [{ activity: 'No recent activities', time: '—', icon: '📌' }];
    }

    // Recent Joinings Card (with proper department name)
    const recentJoinings = recentJoiningsRaw.slice(0, 3).map(emp => ({
      name: `${emp.first_name} ${emp.last_name}`,
      role: emp.role || 'N/A',
      dept: emp.dept_name || 'No Department',
      joinDate: new Date(emp.join_date).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      }),
    }));

    // Upcoming Birthdays
    const currentMonth = new Date().getMonth() + 1;
    const currentDay = new Date().getDate();

    // Ensure birthdays are scoped to the requested company only
    const upcomingBirthdaysRaw = await knex('employees as e')
      .where('e.company_id', companyId)
      .where('e.status', 'active')
      .whereNotNull('e.dob')
      // include company_id for an extra safety-check below
      .select('e.first_name', 'e.last_name', 'e.dob as birth_date', 'e.company_id')
      .whereRaw(
        `(MONTH(e.dob) = ? AND DAY(e.dob) >= ?) OR (MONTH(e.dob) > ?)`,
        [currentMonth, currentDay, currentMonth]
      )
      .orderByRaw('MONTH(e.dob), DAY(e.dob)')
      .limit(3);


    // Extra safety: ensure returned rows truly belong to the requested company
    const filteredBirthdays = upcomingBirthdaysRaw.filter(emp => Number(emp.company_id) === Number(companyId));

    const upcomingBirthdays = filteredBirthdays.map(emp => {
      const bdate = new Date(emp.birth_date);
      const isToday = bdate.getMonth() + 1 === currentMonth && bdate.getDate() === currentDay;
      return {
        name: `${emp.first_name} ${emp.last_name}`,
        date: isToday ? 'Today' : bdate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        emoji: '🎂',
      };
    });

    // Upcoming Holidays
    const upcomingHolidaysRaw = await knex('holidays')
      .where({ company_id: companyId })
      .whereRaw('date >= ?', [today])
      .select('name', 'date', 'type')
      .orderBy('date')
      .limit(4);

    const upcomingHolidays = upcomingHolidaysRaw.map(h => ({
      name: h.name,
      date: new Date(h.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
      type: h.type === 'national' ? 'Public Holiday' : 'Company Holiday',
      icon: h.type === 'national' ? '🇮🇳' : '🏢',
    }));

    // Monthly Attendance
    const monthlyAttendance = await knex('attendance')
      .where({ company_id: companyId })
      .whereRaw('DATE(check_in) >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH)')
      .select(
        knex.raw(`DATE_FORMAT(check_in, '%b-%Y') as month`),
        knex.raw(`COUNT(CASE WHEN LOWER(TRIM(status)) IN ('present','late') THEN 1 END) as present`),
        knex.raw(`COUNT(CASE WHEN LOWER(TRIM(status)) = 'absent' THEN 1 END) as absent`),
        knex.raw(`COUNT(CASE WHEN LOWER(TRIM(status)) = 'half_day' THEN 1 END) as half`)
      )
      .groupByRaw(`DATE_FORMAT(check_in, '%b-%Y')`)
      .orderByRaw(`MIN(check_in)`);

    // Department Headcount with Proper Names
    let departmentData = [];
    try {
      const departmentRaw = await knex('employees as e')
        .leftJoin('departments as d', 'e.department_id', 'd.id')
        .where('e.company_id', companyId)
        .where('e.status', 'active')
        .select('d.name as dept')
        .count('e.id as count')
        .groupBy('d.name')
        .orderBy('count', 'desc');

      departmentData = departmentRaw
        .filter(d => d.dept !== null) // Skip employees with no department
        .map(d => ({
          dept: d.dept || 'Unassigned',
          count: Number(d.count)
        }));

      // Add "Unassigned" count if any employees have NULL department_id
      const unassignedCount = await knex('employees')
        .where({ company_id: companyId, status: 'active' })
        .whereNull('department_id')
        .count('* as count')
        .first();

      if (Number(unassignedCount?.count || 0) > 0) {
        departmentData.push({
          dept: 'Unassigned',
          count: Number(unassignedCount.count)
        });
      }
    } catch (err) {
      console.error('Department chart error (maybe departments table missing?):', err);
      departmentData = [];
    }

    // Department-wise Attendance for Today
    let departmentAttendanceData = [];
    try {
      const deptAttendanceRaw = await knex('attendance as a')
        .leftJoin('employees as e', 'a.employee_id', 'e.id')
        .leftJoin('departments as d', 'e.department_id', 'd.id')
        .where('a.company_id', companyId)
        .whereRaw('DATE(a.check_in) = ?', [today])
        .select(
          'd.name as dept',
          knex.raw(`COUNT(CASE WHEN LOWER(TRIM(a.status)) IN ('present','late') THEN 1 END) as present`),
          knex.raw(`COUNT(CASE WHEN LOWER(TRIM(a.status)) = 'absent' THEN 1 END) as absent`),
          knex.raw(`COUNT(CASE WHEN LOWER(TRIM(a.status)) = 'half_day' THEN 1 END) as half`),
          knex.raw('COUNT(*) as total')
        )
        .groupBy('d.name')
        .orderBy('present', 'desc');

      departmentAttendanceData = deptAttendanceRaw.map(d => ({
        dept: d.dept || 'Unassigned',
        present: Number(d.present || 0),
        absent: Number(d.absent || 0),
        half: Number(d.half || 0),
        total: Number(d.total || 0)
      }));

      // Add unassigned department attendance
      const unassignedAttendance = await knex('attendance as a')
        .leftJoin('employees as e', 'a.employee_id', 'e.id')
        .where('a.company_id', companyId)
        .whereRaw('DATE(a.check_in) = ?', [today])
        .whereNull('e.department_id')
        .select(
          knex.raw(`COUNT(CASE WHEN LOWER(TRIM(a.status)) IN ('present','late') THEN 1 END) as present`),
          knex.raw(`COUNT(CASE WHEN LOWER(TRIM(a.status)) = 'absent' THEN 1 END) as absent`),
          knex.raw(`COUNT(CASE WHEN LOWER(TRIM(a.status)) = 'half_day' THEN 1 END) as half`),
          knex.raw('COUNT(*) as total')
        )
        .first();

      if (Number(unassignedAttendance?.total || 0) > 0) {
        departmentAttendanceData.push({
          dept: 'Unassigned',
          present: Number(unassignedAttendance.present || 0),
          absent: Number(unassignedAttendance.absent || 0),
          half: Number(unassignedAttendance.half || 0),
          total: Number(unassignedAttendance.total || 0)
        });
      }
    } catch (err) {
      console.error('Department attendance error:', err);
      departmentAttendanceData = [];
    }

    // ==================== Final Response ====================
    const dashboardData = {
      kpis: {
        totalEmployees,
        presentToday,
        presentTrend: totalEmployees > 0 ? `${((presentToday / totalEmployees) * 100).toFixed(1)}% attendance` : 'N/A',
        onLeave,
        onLeaveTrend: totalEmployees > 0 ? `${((onLeave / totalEmployees) * 100).toFixed(1)}% of workforce` : 'N/A',
        pendingApprovals,
        pendingTrend: pendingApprovals > 0 ? `${pendingApprovals} pending` : 'All clear',
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
      teamHealth,
    };

    res.status(200).json(dashboardData);
  } catch (error) {
    console.error('Dashboard data error:', error);
    res.status(500).json({ message: 'Failed to fetch dashboard data', error: error.message });
  }
};






const getEmployeeDashboardData = async (req, res) => {
  try {
    const employeeId = req.user.id;
    const companyId = req.user.company_id;

    if (!companyId) {
      return res.status(400).json({ message: 'You are not assigned to any company' });
    }

    const today = new Date().toISOString().split('T')[0];
    const currentMonth = new Date().getMonth() + 1;
    const currentYear = new Date().getFullYear();

    // Get today's attendance status
  const todayAttendance = await knex('attendance')
  .where({
    company_id: companyId,
    employee_id: employeeId,
  })
  .whereIn('status', ['present', 'late'])
  .whereRaw('DATE(check_in) = ?', [today])
  .first();


    // Get leave balance
    const leaveBalance = await knex('leave_balances')
      .where({ 
        company_id: companyId, 
        employee_id: employeeId 
      })
      .sum('available as total_available')
      .first();

    // Get working hours today
    const workingHours = await knex('attendance')
      .where({ 
        company_id: companyId, 
        employee_id: employeeId 
      })
      .whereRaw('DATE(check_in) = ?', [today])
      .select('check_in', 'check_out')
      .first();

    let hoursWorked = 0;
    if (workingHours && workingHours.check_in && workingHours.check_out) {
      const checkIn = new Date(workingHours.check_in);
      const checkOut = new Date(workingHours.check_out);
      hoursWorked = ((checkOut - checkIn) / (1000 * 60 * 60)).toFixed(1);
    }

    // Get monthly attendance data
    const monthlyAttendance = await knex('attendance')
      .where({ 
        company_id: companyId, 
        employee_id: employeeId 
      })
      .whereRaw('MONTH(check_in) = ? AND YEAR(check_in) = ?', [currentMonth, currentYear])
      .select(
        knex.raw('DATE(check_in) as date'),
        'status',
        'check_in',
        'check_out'
      )
      .orderBy('check_in');

    // Format monthly attendance for chart
    const attendanceChartData = monthlyAttendance.map(day => ({
      date: new Date(day.date).getDate(),
      present: (day.status === 'present' || day.status === 'late') ? 1 : 0,
      absent: day.status === 'absent' ? 1 : 0,
      half: day.status === 'half_day' ? 1 : 0
    }));

    // Calculate monthly summary
    const presentDays = monthlyAttendance.filter(a => a.status === 'present' || a.status === 'late').length;
    const absentDays = monthlyAttendance.filter(a => a.status === 'absent').length;
    const halfDays = monthlyAttendance.filter(a => a.status === 'half_day').length;

    const dashboardData = {
      todayStatus: {
        status: todayAttendance ? 'Present' : 'Not Marked',
        checkInTime: todayAttendance ? new Date(todayAttendance.check_in).toLocaleTimeString('en-US', { 
          hour: '2-digit', 
          minute: '2-digit' 
        }) : null,
        description: todayAttendance ? `Checked in at ${new Date(todayAttendance.check_in).toLocaleTimeString('en-US', { 
          hour: '2-digit', 
          minute: '2-digit' 
        })}` : 'Attendance not marked'
      },
      leaveBalance: {
        totalDays: Number(leaveBalance?.total_available || 0),
        description: 'Days remaining this year'
      },
      workingHours: {
        hours: hoursWorked || '0',
        description: 'Hours logged today'
      },
      monthlyAttendance: {
        chartData: attendanceChartData,
        summary: {
          present: presentDays,
          absent: absentDays,
          half: halfDays,
          total: presentDays + absentDays + halfDays
        }
      }
    };

    res.status(200).json(dashboardData);
  } catch (error) {
    console.error('Employee dashboard data error:', error);
    res.status(500).json({ message: 'Failed to fetch employee dashboard data', error: error.message });
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
      return res.status(400).json({ message: 'You are not assigned to any company' });
    }

    // ===============================
    // 1️⃣ Get Manager Department
    // ===============================
    const manager = await knex('employees')
      .where({ id: managerId, company_id: companyId })
      .first();

    if (!manager || !manager.department_id) {
      return res.status(400).json({ message: 'Manager department not found' });
    }

    const departmentId = manager.department_id;

    // ===============================
    // 2️⃣ Total Employees (Department)
    // ===============================
    const totalEmployeesResult = await knex('employees')
      .where('company_id', companyId)
      .where('department_id', departmentId)
      .where('status', 'active')
      .count('* as count')
      .first();

    const totalEmployees = Number(totalEmployeesResult?.count || 0);

    // ===============================
    // 3️⃣ Pending Leaves (Department)
    // ===============================
    const pendingLeavesResult = await knex('leave_applications as la')
      .join('employees as e', 'la.employee_id', 'e.id')
      .where('la.company_id', companyId)
      .where('e.department_id', departmentId)
      .where('la.status', 'pending')
      .count('* as count')
      .first();

    const pendingLeaves = Number(pendingLeavesResult?.count || 0);

    // ===============================
    // 4️⃣ Pending Expenses (Department)
    // ===============================
    const pendingExpensesResult = await knex('expenses as ex')
      .join('employees as e', 'ex.employee_id', 'e.id')
      .where('ex.company_id', companyId)
      .where('e.department_id', departmentId)
      .where('ex.status', 'Pending')
      .count('* as count')
      .first();

    const pendingExpenses = Number(pendingExpensesResult?.count || 0);

    // ===============================
    // 5️⃣ New Joinees This Month (Department)
    // ===============================
    const newJoineesResult = await knex('employees')
      .where('company_id', companyId)
      .where('department_id', departmentId)
      .where('status', 'active')
      .whereRaw('MONTH(created_at) = MONTH(CURDATE())')
      .whereRaw('YEAR(created_at) = YEAR(CURDATE())')
      .count('* as count')
      .first();

    const newJoinees = Number(newJoineesResult?.count || 0);

    // ===============================
    // 6️⃣ Present Today
    // ===============================
    const presentTodayResult = await knex('attendance as a')
      .join('employees as e', 'a.employee_id', 'e.id')
      .where('a.company_id', companyId)
      .where('e.department_id', departmentId)
      .whereNotNull('a.check_in')
      .whereRaw('DATE(a.check_in) = CURDATE()')
      .whereIn('a.status', ['present', 'late'])
      .countDistinct('a.employee_id as count')
      .first();

    const presentToday = Number(presentTodayResult?.count || 0);

    // ===============================
    // 7️⃣ On Leave Today
    // ===============================
    const onLeaveTodayResult = await knex('leave_applications as la')
      .join('employees as e', 'la.employee_id', 'e.id')
      .where('la.company_id', companyId)
      .where('e.department_id', departmentId)
      .where('la.status', 'approved')
      .whereRaw('CURDATE() BETWEEN la.from_date AND la.to_date')
      .countDistinct('la.employee_id as count')
      .first();

    const onLeaveToday = Number(onLeaveTodayResult?.count || 0);

    // ===============================
    // 🆕 11️⃣ Monthly Attendance Summary (Department)
    // ===============================
    const monthlyAttendanceSummary = await knex('attendance as a')
      .join('employees as e', 'a.employee_id', 'e.id')
      .where('a.company_id', companyId)
      .where('e.department_id', departmentId)
      .whereRaw('MONTH(a.check_in) = MONTH(CURDATE())')
      .whereRaw('YEAR(a.check_in) = YEAR(CURDATE())')
      .select(
        knex.raw("SUM(CASE WHEN a.status = 'present' OR a.status = 'late' THEN 1 ELSE 0 END) as present_count"),
        knex.raw("SUM(CASE WHEN a.status = 'absent' THEN 1 ELSE 0 END) as absent_count"),
        knex.raw("COUNT(a.id) as total_records")
      )
      .first();

    const monthlyAttendance = {
      present: Number(monthlyAttendanceSummary?.present_count || 0),
      absent: Number(monthlyAttendanceSummary?.absent_count || 0),
      totalRecords: Number(monthlyAttendanceSummary?.total_records || 0)
    };

    // ===============================
    // 🆕 12️⃣ Monthly Attendance By Employee (For Charts / Table)
    // ===============================
    const monthlyAttendanceByEmployee = await knex('attendance as a')
      .join('employees as e', 'a.employee_id', 'e.id')
      .where('a.company_id', companyId)
      .where('e.department_id', departmentId)
      .whereRaw('MONTH(a.check_in) = MONTH(CURDATE())')
      .whereRaw('YEAR(a.check_in) = YEAR(CURDATE())')
      .groupBy('a.employee_id')
      .select(
        'a.employee_id',
        'e.first_name',
        'e.last_name',
        knex.raw("SUM(CASE WHEN a.status = 'present' OR a.status = 'late' THEN 1 ELSE 0 END) as present_days"),
        knex.raw("SUM(CASE WHEN a.status = 'absent' THEN 1 ELSE 0 END) as absent_days"),
        knex.raw("COUNT(a.id) as total_days")
      );

    // ===============================
    // 8️⃣ Department Employees List
    // ===============================
    const employees = await knex('employees')
      .select('id', 'employee_id', 'first_name', 'last_name', 'email', 'designation_id', 'status')
      .where('company_id', companyId)
      .where('department_id', departmentId);

    // ===============================
    // 9️⃣ Department Leaves List
    // ===============================
    const leaves = await knex('leave_applications as la')
      .join('employees as e', 'la.employee_id', 'e.id')
      .select(
        'la.id',
        'la.from_date',
        'la.to_date',
        'la.status',
        'la.reason',
        'e.first_name',
        'e.last_name',
        'e.employee_id'
      )
      .where('la.company_id', companyId)
      .where('e.department_id', departmentId)
      .orderBy('la.created_at', 'desc');

    // ===============================
    // 🔟 Department Expenses List
    // ===============================
    const expenses = await knex('expenses as ex')
      .join('employees as e', 'ex.employee_id', 'e.id')
      .select(
        'ex.id',
        'ex.expense_id',
        'ex.amount',
        'ex.status',
        'ex.created_at',
        'e.first_name',
        'e.last_name',
        'e.employee_id'
      )
      .where('ex.company_id', companyId)
      .where('e.department_id', departmentId)
      .orderBy('ex.created_at', 'desc');

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
        onLeaveToday
      },
      monthlyAttendance,                 // 🆕 SUMMARY
      monthlyAttendanceByEmployee,       // 🆕 PER EMPLOYEE
      departmentInfo: {
        department_id: departmentId
      },
      employees,
      leaves,
      expenses
    });

  } catch (error) {
    console.error('Manager dashboard data error:', error);
    res.status(500).json({
      message: 'Failed to fetch manager dashboard data',
      error: error.message
    });
  }
};


const getHRDashboardData = async (req, res) => {
  try {
    const companyId = req.user.company_id;

    if (!companyId) {
      return res.status(400).json({ message: 'You are not assigned to any company' });
    }

    const today = new Date().toISOString().split('T')[0];
    const currentMonth = new Date().getMonth() + 1;
    const currentYear = new Date().getFullYear();

    // Get total employees
    const totalEmployeesResult = await knex('employees')
      .where({ company_id: companyId, status: 'active' })
      .count('* as count')
      .first();
    const totalEmployees = Number(totalEmployeesResult?.count || 0);

    // Get pending resignations
    const pendingResignations = await knex('resignations')
      .where({ company_id: companyId, approval_status: 'pending' })
      .count('* as count')
      .first();
    const pendingExits = Number(pendingResignations?.count || 0);

    // Get pending leave applications (for HR approval)
    const pendingLeaveApplications = await knex('leave_applications')
      .where({ company_id: companyId, status: 'pending' })
      .count('* as count')
      .first();
    const pendingLeaveCount = Number(pendingLeaveApplications?.count || 0);

    // Get new joiners this month
    const newJoinersResult = await knex('employees')
      .where({ company_id: companyId, status: 'active' })
      .whereRaw('MONTH(doj) = ? AND YEAR(doj) = ?', [currentMonth, currentYear])
      .count('* as count')
      .first();
    const newJoiners = Number(newJoinersResult?.count || 0);

    // Get department-wise headcount
    const departmentData = await knex('employees as e')
      .leftJoin('departments as d', 'e.department_id', 'd.id')
      .where('e.company_id', companyId)
      .where('e.status', 'active')
      .select('d.name as dept')
      .count('e.id as count')
      .groupBy('d.name')
      .orderBy('count', 'desc');

    const departmentChartData = departmentData
      .filter(d => d.dept !== null)
      .map(d => ({
        dept: d.dept || 'Unassigned',
        count: Number(d.count)
      }));

    const dashboardData = {
      hrStats: {
        totalEmployees,
        pendingExits,
        pendingLeaveApprovals: pendingLeaveCount,
        newJoiners
      },
      departmentData: departmentChartData
    };

    res.status(200).json(dashboardData);
  } catch (error) {
    console.error('HR dashboard data error:', error);
    res.status(500).json({ message: 'Failed to fetch HR dashboard data', error: error.message });
  }
};

const getFinanceDashboardData = async (req, res) => {
  try {
    const companyId = req.user.company_id;

    if (!companyId) {
      return res.status(400).json({ message: 'You are not assigned to any company' });
    }

    const currentMonth = new Date().getMonth() + 1;
    const currentYear = new Date().getFullYear();

    console.log(`Fetching data for companyId: ${companyId}, Year: ${currentYear}, Month: ${currentMonth}`);
    console.log(`Month filter: ${currentYear}-${currentMonth.toString().padStart(2, '0')}`);

    // Fix existing payroll data with corrected calculation
    const existingPayroll = await knex('payroll_processing')
      .where({ company_id: companyId })
      .whereRaw('month = ?', [`${currentYear}-${currentMonth.toString().padStart(2, '0')}`]);

    for (const payroll of existingPayroll) {
      const correctedNet = payroll.gross - payroll.deductions;
      await knex('payroll_processing')
        .where({ id: payroll.id })
        .update({ net: correctedNet > 0 ? correctedNet : 0 });
    }

    // Get monthly payroll total
    const monthlyPayrollResult = await knex('payroll_processing')
      .where({ company_id: companyId })
      .whereRaw('month = ?', [`${currentYear}-${currentMonth.toString().padStart(2, '0')}`])
      .sum('net as total')
      .first();
    console.log('monthlyPayrollResult:', monthlyPayrollResult);
    const monthlyPayroll = Number(monthlyPayrollResult?.total || 0);

    // Get pending expense claims
    const pendingExpensesResult = await knex('expenses')
      .where({ company_id: companyId, status: 'pending' })
      .sum('amount as total')
      .first();
    const pendingExpenses = Number(pendingExpensesResult?.total || 0);

    // Get payslips generated this month
    const payslipsGeneratedResult = await knex('payroll_processing')
      .where({ company_id: companyId })
      .whereRaw('month = ?', [`${currentYear}-${currentMonth.toString().padStart(2, '0')}`])
      .count('* as count')
      .first();
    console.log('payslipsGeneratedResult:', payslipsGeneratedResult);
    const payslipsGenerated = Number(payslipsGeneratedResult?.count || 0);

    // Get budget utilization (simplified calculation)
    const annualBudget = 5000000; // This should come from a budget table
    const ytdPayrollResult = await knex('payroll_processing')
      .where({ company_id: companyId })
      .whereRaw('YEAR(created_at) = ?', [currentYear])
      .sum('net as total')
      .first();
    const ytdPayroll = Number(ytdPayrollResult?.total || 0);
    const budgetUtilization = Math.round((ytdPayroll / annualBudget) * 100);

    // Get monthly payroll trend for the last 6 months
    const payrollTrend = await knex('payroll_processing')
      .where({ company_id: companyId })
      .whereRaw('created_at >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH)')
      .select(
        knex.raw('DATE_FORMAT(created_at, "%b") as month'),
        knex.raw('COUNT(*) as employees'),
        knex.raw('SUM(net) as total')
      )
      .groupByRaw('DATE_FORMAT(created_at, "%b-%Y")')
      .orderByRaw('MIN(created_at)');

    const payrollChartData = payrollTrend.map(item => ({
      month: item.month,
      present: Number(item.employees),
      total: Number(item.total)
    }));

    const dashboardData = {
      financeStats: {
        monthlyPayroll: monthlyPayroll !== 0 ? `₹${monthlyPayroll.toLocaleString('en-IN')}` : '₹0',
        pendingExpenses: pendingExpenses > 0 ? `₹${pendingExpenses.toLocaleString('en-IN')}` : '₹0',
        payslipsGenerated,
        budgetUtilization: `${budgetUtilization}%`
      },
      payrollTrend: payrollChartData
    };

    console.log('Final dashboard data:', dashboardData);
    console.log('Raw monthlyPayroll:', monthlyPayroll);
    console.log('Raw payslipsGenerated:', payslipsGenerated);

    res.status(200).json(dashboardData);
  } catch (error) {
    console.error('Finance dashboard data error:', error);
    res.status(500).json({ message: 'Failed to fetch finance dashboard data', error: error.message });
  }
};

module.exports = {
  getAdminDashboardData,
  getEmployeeDashboardData,
  getManagerDashboardData,
  getHRDashboardData,
  getFinanceDashboardData
};
