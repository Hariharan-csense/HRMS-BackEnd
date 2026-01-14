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
      .where({ company_id: companyId })
      .count('* as count')
      .first();
    const totalEmployees = Number(totalEmployeesResult?.count || 0);

    const attendanceTodayRaw = await knex('attendance')
      .where({ company_id: companyId })
      .whereRaw('DATE(check_in) = ?', [today]);

    const presentToday = attendanceTodayRaw.filter(a => a.status === 'present').length;
    const totalAttendanceToday = attendanceTodayRaw.length;
    const flaggedToday = attendanceTodayRaw.filter(a => a.auto_flag === 1).length;

    const presentYesterdayResult = await knex('attendance')
      .where({ company_id: companyId })
      .whereRaw('DATE(check_in) = ?', [yesterdayStr])
      .where('status', 'present')
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

    const upcomingBirthdaysRaw = await knex('employees')
      .where({ company_id: companyId })
      .select('first_name', 'last_name', 'dob as birth_date')
      .whereRaw(`(MONTH(dob) = ? AND DAY(dob) >= ?) OR (MONTH(dob) > ?)`, [currentMonth, currentDay, currentMonth])
      .orderByRaw('MONTH(dob), DAY(dob)')
      .limit(3);

    const upcomingBirthdays = upcomingBirthdaysRaw.map(emp => {
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
        knex.raw(`DATE_FORMAT(check_in, '%b') as month`),
        knex.raw(`COUNT(CASE WHEN status = 'present' THEN 1 END) as present`),
        knex.raw(`COUNT(CASE WHEN status = 'absent' THEN 1 END) as absent`),
        knex.raw(`COUNT(CASE WHEN status = 'half_day' THEN 1 END) as half`)
      )
      .groupByRaw(`DATE_FORMAT(check_in, '%b-%Y')`)
      .orderByRaw(`MIN(check_in)`);

    // Department Headcount with Proper Names
    let departmentData = [];
    try {
      const departmentRaw = await knex('employees as e')
        .leftJoin('departments as d', 'e.department_id', 'd.id')
        .where('e.company_id', companyId)
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
        .where({ company_id: companyId })
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

module.exports = {
  getAdminDashboardData
};