// controllers/reports.controller.js

const knex = require('../db/db'); // ← Fixed path (CommonJS require)

// Helper to get current year if not provided
const getYear = (req) => Number(req.query.year) || new Date().getFullYear();

/* =========================
   ATTENDANCE REPORT
========================= */
// Updated getAttendanceReport function (replace in your reports.controller.js)

// Final Fixed getAttendanceReport (replace in reports.controller.js)

const getAttendanceReport = async (req, res) => {
  const companyId = req.user.company_id;
  const year = getYear(req); // e.g., 2026

  try {
    // Fetch monthly aggregates (only months with attendance data)
    const trendRaw = await knex('attendance')
      .select(
        knex.raw("DATE_FORMAT(check_in, '%M') as month"),
        knex.raw("SUM(CASE WHEN status = 'present' THEN 1 ELSE 0 END) as present"),
        knex.raw("SUM(CASE WHEN status = 'absent' THEN 1 ELSE 0 END) as absent"),
        knex.raw("SUM(CASE WHEN status = 'half' THEN 1 ELSE 0 END) as half")
      )
      .where({ company_id: companyId })
      .whereNotNull('check_in')
      .andWhereRaw('YEAR(check_in) = ?', [year])
      .groupByRaw("DATE_FORMAT(check_in, '%Y-%m')");

    // Create a map for quick lookup
    const monthMap = {};
    trendRaw.forEach(row => {
      monthMap[row.month] = {
        present: Number(row.present || 0),
        absent: Number(row.absent || 0),
        half: Number(row.half || 0),
      };
    });

    // Full 12 months with 0s for missing months
    const monthsOrder = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];

    const trend = monthsOrder.map(month => ({
      month,
      present: monthMap[month]?.present || 0,
      absent: monthMap[month]?.absent || 0,
      half: monthMap[month]?.half || 0,
    }));

    // Summary stats
    const totalEmployees = await knex('employees')
      .count('* as count')
      .where({ company_id: companyId })
      .first();

    // Company-wide average attendance % (weighted by actual attendance records)
    const avgAttendanceRaw = await knex('attendance')
      .select(
        knex.raw("SUM(CASE WHEN status = 'present' THEN 1 WHEN status = 'half' THEN 0.5 ELSE 0 END) / COUNT(*) * 100 as avg_att")
      )
      .where({ company_id: companyId })
      .whereNotNull('check_in')
      .andWhereRaw('YEAR(check_in) = ?', [year])
      .first();

    // Today's stats (use DATE(check_in) for accurate date match)
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const todayStats = await knex('attendance')
      .select('status')
      .count('* as count')
      .where({ company_id: companyId })
      .whereNotNull('check_in')
      .whereRaw('DATE(check_in) = ?', [today])
      .groupBy('status');

    const presentToday = todayStats.find(s => s.status === 'present')?.count || 0;
    const onLeaveToday = todayStats.find(s => s.status === 'leave')?.count || 0; // will be 0 if no 'leave' status

    const summary = {
      totalEmployees: totalEmployees?.count || 0,
      avgAttendance: avgAttendanceRaw?.avg_att ? `${Number(avgAttendanceRaw.avg_att).toFixed(1)}%` : '0%',
      presentToday,
      onLeave: onLeaveToday,
    };

    res.json({
      success: true,
      data: { trend, summary },
    });
  } catch (err) {
    console.error('Attendance report error:', err);
    res.status(500).json({ success: false, message: 'Failed to generate attendance report' });
  }
};
/* =========================
   LEAVE REPORT
========================= */
// Fixed getLeaveReport function (replace in your reports.controller.js)

const getLeaveReport = async (req, res) => {
  const companyId = req.user.company_id;
  const year = getYear(req); // optional: current year or from query

  try {
    // Use correct table: leave_applications (not 'leaves')
    // Assume column is 'leave_type_name' based on your earlier code
    const distribution = await knex('leave_applications')
      .select('leave_type_name as name')
      .count('* as value')
      .where({ company_id: companyId, status: 'approved' })
      .andWhereRaw('YEAR(from_date) = ?', [year]) // filter by year (optional, remove if you want all time)
      .groupBy('leave_type_name');

    // Add colors for PieChart (same as frontend)
    const colors = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#6366f1'];
    const leaveData = distribution.map((row, idx) => ({
      name: row.name || 'Other',
      value: Number(row.value),
      fill: colors[idx % colors.length],
    }));

    // Statistics
    const totalEmployees = await knex('employees')
      .count('* as count')
      .where({ company_id: companyId })
      .first();

    const approved = await knex('leave_applications')
      .count('* as count')
      .where({ company_id: companyId, status: 'approved' })
      .first();

    const pending = await knex('leave_applications')
      .count('* as count')
      .where({ company_id: companyId, status: 'pending' })
      .first();

    // Average days used (assume 'days' column exists in leave_applications)
    const avgDays = await knex('leave_applications')
      .avg('days as avg')
      .where({ company_id: companyId, status: 'approved' })
      .first();

    const stats = {
      totalEmployees: totalEmployees?.count || 0,
      approvedLeaves: approved?.count || 0,
      pendingRequests: pending?.count || 0,
      avgDaysUsed: Number(avgDays?.avg || 0).toFixed(1),
    };

    res.json({
      success: true,
      data: { distribution: leaveData, stats },
    });
  } catch (err) {
    console.error('Leave report error:', err);
    res.status(500).json({ success: false, message: 'Failed to generate leave report' });
  }
};

/* =========================
   PAYROLL REPORT
========================= */
// Updated getPayrollReport (replace in reports.controller.js)
const getPayrollReport = async (req, res) => {
  const companyId = req.user.company_id;
  const year = getYear(req);

  try {
    console.log(`Generating payroll report for company: ${companyId}, year: ${year}`);

    // Get data with a simpler year filter
    const trendRaw = await knex('payroll_processing')
      .select(
        'month', // Select the raw month value
        knex.raw('SUM(gross) as amount')
      )
      .where({ company_id: companyId })
      .andWhere(knex.raw(`month LIKE '${year}-%'`))
      .groupBy('month')  // Group by the raw month value
      .orderBy('month');  // Order by the raw month value

    console.log('Trend data with simplified filter:', JSON.stringify(trendRaw, null, 2));

    // Create a map of month number to amount
    const monthMap = {};
    trendRaw.forEach(row => {
      // Extract month number from 'YYYY-MM' format (1-12)
      const monthNum = parseInt(row.month.split('-')[1], 10) - 1; // Convert to 0-11 for JS
      monthMap[monthNum] = Math.round(Number(row.amount) / 1000); // in ₹K
    });

    const monthsOrder = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];

    const trend = monthsOrder.map((month, index) => ({
      month,
      amount: monthMap[index] || 0
    }));

    // Calculate summary data
    const totalEmployees = await knex('employees')
      .count('* as count')
      .where({ company_id: companyId })
      .first();

    const avgSalaryRaw = await knex('payroll_structures')
      .avg('gross as avg')
      .where({ company_id: companyId })
      .first();

    // Calculate YTD total
    const ytdTotal = trendRaw.reduce((sum, row) => sum + Number(row.amount), 0);

    // Get current month data (0-11)
    const currentMonth = new Date().getMonth();
    const currentMonthData = monthMap[currentMonth] || 0;

    const summary = {
      totalEmployees: totalEmployees?.count || 0,
      avgSalary: avgSalaryRaw?.avg ? `₹${Math.round(Number(avgSalaryRaw.avg)).toLocaleString()}` : '₹0',
      totalPayroll: currentMonthData ? `₹${currentMonthData}K` : '₹0K',
      ytdAmount: ytdTotal ? `₹${(ytdTotal / 1000000).toFixed(1)}M` : '₹0M',
    };

    console.log('Final response:', { trend, summary });

    res.json({
      success: true,
      data: { trend, summary },
    });
  } catch (err) {
    console.error('Payroll report error:', err);
    res.status(500).json({ success: false, message: 'Failed to generate payroll report' });
  }
};
/* =========================
   EXPENSE REPORT
========================= */
const getExpenseReport = async (req, res) => {
  const companyId = req.user.company_id;
  const year = getYear(req);

  try {
    console.log(`Fetching expense report for company: ${companyId}, year: ${year}`);

    // First, check if any expenses exist at all
    const allExpenses = await knex('expenses')
      .where({ company_id: companyId })
      .select('category', 'amount', 'status');
    
    console.log('All expenses for company:', JSON.stringify(allExpenses, null, 2));

    // First, get all categories to ensure we don't miss any
    const allCategories = await knex('expenses')
      .distinct('category')
      .where({ company_id: companyId })
      .pluck('category');

    console.log('All categories found:', allCategories);

    // Get category data without year filter first to debug
    const allCategoryData = await knex('expenses')
      .select('category')
      .sum('amount as amount')
      .where({ 
        company_id: companyId, 
        status: 'Approved'  // Match database enum values
      })
      .groupBy('category');

    console.log('All category data (no year filter):', JSON.stringify(allCategoryData, null, 2));

    // Then get data with year filter
    const categoryData = await knex('expenses')
      .select('category')
      .sum('amount as amount')
      .where({ 
        company_id: companyId, 
        status: 'Approved'  // Match database enum values
      })
      .andWhereRaw('YEAR(expense_date) = ?', [year])
      .groupBy('category');

    console.log('Filtered category data (with year filter):', JSON.stringify(categoryData, null, 2));

    // Process summary data using filtered data
    let summaryData = categoryData
      .filter(row => row.category) // Filter out null/undefined categories
      .map(row => ({
        category: row.category,
        amount: Math.round(Number(row.amount) || 0),
      }));

    // If still empty, try without any status filter
    if (summaryData.length === 0) {
      console.log('Summary is empty, trying without status filter...');
      const fallbackData = await knex('expenses')
        .select('category')
        .sum('amount as amount')
        .where({ company_id: companyId })
        .groupBy('category');
      
      summaryData = fallbackData
        .filter(row => row.category)
        .map(row => ({
          category: row.category,
          amount: Math.round(Number(row.amount) || 0),
        }));
      
      console.log('Fallback summary data:', JSON.stringify(summaryData, null, 2));
    }

    console.log('Final summary data:', JSON.stringify(summaryData, null, 2));

    // Get stats with proper null handling
    const [totalClaims, totalAmount, pendingAmount] = await Promise.all([
      knex('expenses')
        .count('* as count')
        .where({ company_id: companyId })
        .first(),
      knex('expenses')
        .sum('amount as total')
        .where({ 
          company_id: companyId, 
          status: 'Approved'  // Match database enum values
        })
        .first(),
      knex('expenses')
        .sum('amount as total')
        .where({ 
          company_id: companyId, 
          status: 'Pending'  // Match database enum values
        })
        .first()
    ]);

    console.log('Stats raw data:', {
      totalClaims,
      totalAmount,
      pendingAmount
    });

    const response = {
      success: true,
      data: {
        summary: summaryData,
        stats: {
          totalClaims: Number(totalClaims?.count) || 0,
          totalAmount: totalAmount?.total ? `₹${Math.round(Number(totalAmount.total)).toLocaleString()}` : '₹0',
          pendingApproval: pendingAmount?.total ? `₹${Math.round(Number(pendingAmount.total)).toLocaleString()}` : '₹0',
        }
      }
    };

    console.log('Final response:', JSON.stringify(response, null, 2));
    res.json(response);

  } catch (err) {
    console.error('Expense report error:', err);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to generate expense report',
      error: err.message 
    });
  }
};

// Export all functions (CommonJS)
module.exports = {
  getAttendanceReport,
  getLeaveReport,
  getPayrollReport,
  getExpenseReport,
};