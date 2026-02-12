const knex = require('../db/db');


// const getSalesAttendanceComparison = async (req, res) => {
//   try {
//     const { startDate, endDate } = req.query;
//     const companyId = req.user.company_id;

//     const start = startDate || new Date().toISOString().split('T')[0];
//     const end = endDate || new Date().toISOString().split('T')[0];

//     // ===============================
//     // 1️⃣ Sales Employees
//     // ===============================
//     const salesEmployees = await knex('employees')
//       .leftJoin('departments', 'employees.department_id', 'departments.id')
//       .select(
//         'employees.id',
//         'employees.first_name',
//         'employees.last_name',
//         'employees.employee_id',
//         'employees.email',
//         'departments.name as department_name'
//       )
//       .where('employees.company_id', companyId)
//       .where('departments.name', 'like', '%sales%')
//       .where('employees.status', 'Active'); // ✅ CASE FIX

//     // ===============================
//     // 2️⃣ Regular Attendance (FIXED FOR YOUR TABLE)
//     // ===============================
//     const regularAttendance = await knex('attendance')
//       .leftJoin('employees', 'attendance.employee_id', 'employees.id')
//       .leftJoin('departments', 'employees.department_id', 'departments.id')
//       .select(
//         'attendance.employee_id',
//         knex.raw('DATE(attendance.check_in) as date'), // ✅ FIXED
//         'attendance.check_in',
//         'attendance.check_out'
//       )
//       .where('employees.company_id', companyId)
//       .where('departments.name', 'like', '%sales%')
//       .whereRaw('DATE(attendance.check_in) BETWEEN ? AND ?', [start, end]); // ✅ FIXED

//     // ===============================
//     // 3️⃣ Client Attendance (ALREADY CORRECT)
//     // ===============================
//     const clientAttendance = await knex('client_attendance')
//       .leftJoin('employees', 'client_attendance.employee_id', 'employees.id')
//       .leftJoin('clients', 'client_attendance.client_id', 'clients.id')
//       .leftJoin('departments', 'employees.department_id', 'departments.id')
//       .select(
//         'client_attendance.employee_id',
//         'client_attendance.date',
//         'client_attendance.duration_minutes',
//         'clients.client_name'
//       )
//       .where('employees.company_id', companyId)
//       .where('departments.name', 'like', '%sales%')
//       .whereBetween('client_attendance.date', [start, end]);

//     // ===============================
//     // 4️⃣ PROCESS COMPARISON
//     // ===============================
//     const employeeComparison = salesEmployees.map(employee => {
//       const empId = employee.id;

//       const empRegularAttendance = regularAttendance.filter(
//         att => att.employee_id === empId
//       );

//       const empClientAttendance = clientAttendance.filter(
//         att => att.employee_id === empId
//       );

//       const regularDates = new Set(empRegularAttendance.map(att => att.date));
//       const clientDates = new Set(empClientAttendance.map(att => att.date));

//       const bothDays = [...regularDates].filter(d => clientDates.has(d)).length;

//       const totalWorkingDays = new Set([
//         ...regularDates,
//         ...clientDates
//       ]).size;

//       const totalClientHours =
//         empClientAttendance.reduce((sum, att) => {
//           return sum + (att.duration_minutes || 0) / 60;
//         }, 0);

//       const uniqueClients = new Set(
//         empClientAttendance.map(att => att.client_name)
//       ).size;

//       return {
//         employee_id: employee.employee_id,
//         employee_name: `${employee.first_name} ${employee.last_name}`,
//         email: employee.email,
//         department: employee.department_name,

//         total_working_days: totalWorkingDays,
//         regular_attendance_days: regularDates.size,
//         client_attendance_days: clientDates.size,
//         both_attendance_days: bothDays,

//         regular_only_days: regularDates.size - bothDays,
//         client_only_days: clientDates.size - bothDays,

//         total_client_hours: Math.round(totalClientHours * 100) / 100,
//         unique_clients_visited: uniqueClients,

//         attendance_pattern: getAttendancePattern(
//           regularDates.size,
//           clientDates.size,
//           bothDays
//         ),

//         client_attendance_percentage:
//           totalWorkingDays > 0
//             ? Math.round((clientDates.size / totalWorkingDays) * 100)
//             : 0
//       };
//     });

//     // ===============================
//     // 5️⃣ Department Summary
//     // ===============================
//     const departmentSummary = {
//       total_sales_employees: salesEmployees.length,
//       employees_with_client_attendance: employeeComparison.filter(
//         e => e.client_attendance_days > 0
//       ).length,
//       employees_with_regular_attendance: employeeComparison.filter(
//         e => e.regular_attendance_days > 0
//       ).length,
//       total_client_visits: employeeComparison.reduce(
//         (sum, e) => sum + e.client_attendance_days,
//         0
//       ),
//       total_regular_days: employeeComparison.reduce(
//         (sum, e) => sum + e.regular_attendance_days,
//         0
//       ),
//       total_client_hours: Math.round(
//         employeeComparison.reduce((sum, e) => sum + e.total_client_hours, 0) * 100
//       ) / 100,
//       average_client_attendance_percentage:
//         salesEmployees.length > 0
//           ? Math.round(
//               employeeComparison.reduce(
//                 (sum, e) => sum + e.client_attendance_percentage,
//                 0
//               ) / salesEmployees.length
//             )
//           : 0
//     };

//     // ===============================
//     // ✅ FINAL RESPONSE
//     // ===============================
//     res.json({
//       success: true,
//       data: {
//         department_summary: departmentSummary,
//         employee_comparison: employeeComparison,
//         period: {
//           start_date: start,
//           end_date: end
//         }
//       }
//     });

//   } catch (error) {
//     console.error('Error fetching sales attendance comparison:', error);
//     res.status(500).json({
//       success: false,
//       error: 'Failed to fetch sales attendance comparison'
//     });
//   }
// };


const getSalesAttendanceComparison = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const companyId = req.user.company_id;

    const start = startDate || new Date().toISOString().split('T')[0];
    const end = endDate || new Date().toISOString().split('T')[0];

    /* =====================================================
       1️⃣ SALES EMPLOYEES (ROLE = employee + SALES DEPT/DESIGNATION)
    ===================================================== */
    const salesEmployees = await knex('employees')
      .leftJoin('departments', 'employees.department_id', 'departments.id')
      .leftJoin('designations', 'employees.designation_id', 'designations.id')
      .select(
        'employees.id',
        'employees.employee_id',
        'employees.first_name',
        'employees.last_name',
        'employees.email',
        'employees.role',
        'departments.name as department_name',
        'designations.name as designation_name'
      )
      .where('employees.company_id', companyId)
      .where('employees.status', 'Active')
      .where('employees.role', 'employee')
      .andWhere(function () {
        this.whereRaw('LOWER(departments.name) = ?', ['sales'])
          .orWhereRaw('LOWER(designations.name) LIKE ?', ['%sales%']);
      });

    if (!salesEmployees.length) {
      return res.json({
        success: true,
        message: 'No sales employees found',
        data: []
      });
    }

    const salesEmployeeIds = salesEmployees.map(e => e.id);

    /* =====================================================
       2️⃣ REGULAR ATTENDANCE
    ===================================================== */
    const regularAttendance = await knex('attendance')
      .select(
        'attendance.employee_id',
        knex.raw('DATE(attendance.check_in) as date')
      )
      .whereIn('attendance.employee_id', salesEmployeeIds)
      .whereRaw('DATE(attendance.check_in) BETWEEN ? AND ?', [start, end]);

    /* =====================================================
       3️⃣ CLIENT ATTENDANCE
    ===================================================== */
    const clientAttendance = await knex('client_attendance')
      .leftJoin('clients', 'client_attendance.client_id', 'clients.id')
      .select(
        'client_attendance.employee_id',
        'client_attendance.date',
        'client_attendance.duration_minutes',
        'clients.client_name'
      )
      .whereIn('client_attendance.employee_id', salesEmployeeIds)
      .whereBetween('client_attendance.date', [start, end]);

    /* =====================================================
       4️⃣ PROCESS RESULT
    ===================================================== */
    const employeeComparison = salesEmployees.map(emp => {
      const empRegular = regularAttendance.filter(
        a => a.employee_id === emp.id
      );

      const empClient = clientAttendance.filter(
        a => a.employee_id === emp.id
      );

      const regularDates = new Set(empRegular.map(a => a.date));
      const clientDates = new Set(empClient.map(a => a.date));

      const bothDays = [...regularDates].filter(d => clientDates.has(d)).length;

      const totalWorkingDays = new Set([
        ...regularDates,
        ...clientDates
      ]).size;

      const totalClientHours =
        empClient.reduce(
          (sum, a) => sum + ((a.duration_minutes || 0) / 60),
          0
        );

      return {
        employee_id: emp.employee_id,
        employee_name: `${emp.first_name} ${emp.last_name}`,
        email: emp.email,
        department: emp.department_name,
        designation: emp.designation_name,

        total_working_days: totalWorkingDays,
        regular_attendance_days: regularDates.size,
        client_attendance_days: clientDates.size,
        both_attendance_days: bothDays,

        total_client_hours: Math.round(totalClientHours * 100) / 100,
        unique_clients_visited: new Set(
          empClient.map(a => a.client_name)
        ).size
      };
    });

    /* =====================================================
       ✅ FINAL RESPONSE
    ===================================================== */
    res.json({
      success: true,
      data: {
        period: { start_date: start, end_date: end },
        total_sales_employees: salesEmployees.length,
        employee_comparison: employeeComparison
      }
    });

  } catch (error) {
    console.error('Sales attendance error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch sales attendance'
    });
  }
};







const getAttendancePattern = (regularDays, clientDays, bothDays) => {
  const total = regularDays + clientDays;
  if (total === 0) return 'No Attendance';
  
  const clientRatio = clientDays / total;
  
  if (clientRatio >= 0.8) return 'Client-Focused';
  if (clientRatio >= 0.5) return 'Mixed (Client-Heavy)';
  if (clientRatio >= 0.2) return 'Mixed (Office-Heavy)';
  return 'Office-Focused';
};

// Get detailed attendance for a specific sales employee
// const getSalesEmployeeDetail = async (req, res) => {
//   try {
//     const { employeeId } = req.params;
//     const { startDate, endDate } = req.query;
//     const companyId = req.user.company_id;

//     // Verify employee is in sales department
//     const employee = await knex('employees')
//       .leftJoin('departments', 'employees.department_id', 'departments.id')
//       .select(
//         'employees.id',
//         'employees.first_name',
//         'employees.last_name',
//         'employees.employee_id',
//         'departments.name as department_name'
//       )
//       .where('employees.id', employeeId)
//       .where('employees.company_id', companyId)
//       .where('departments.name', 'like', '%sales%')
//       .first();

//     if (!employee) {
//       return res.status(404).json({
//         success: false,
//         error: 'Sales employee not found'
//       });
//     }

//     // Get daily attendance comparison
//     const dailyComparison = await knex.raw(`
//       WITH dates AS (
//         SELECT generate_series(
//           ?::date, 
//           ?::date, 
//           '1 day'::interval
//         )::date as date
//       ),
//       regular_attendance AS (
//         SELECT 
//           date,
//           check_in_time,
//           check_out_time,
//           'regular' as attendance_type
//         FROM attendance 
//         WHERE employee_id = ? 
//         AND date BETWEEN ? AND ?
//       ),
//       client_attendance AS (
//         SELECT 
//           date,
//           MIN(check_in_time) as first_check_in,
//           MAX(check_out_time) as last_check_out,
//           COUNT(*) as client_visits,
//           SUM(duration_minutes) as total_minutes,
//           'client' as attendance_type
//         FROM client_attendance 
//         WHERE employee_id = ? 
//         AND date BETWEEN ? AND ?
//         GROUP BY date
//       )
//       SELECT 
//         d.date,
//         ra.check_in_time as regular_check_in,
//         ra.check_out_time as regular_check_out,
//         ca.first_check_in as client_first_check_in,
//         ca.last_check_out as client_last_check_out,
//         ca.client_visits,
//         ca.total_minutes,
//         CASE 
//           WHEN ra.check_in_time IS NOT NULL AND ca.first_check_in IS NOT NULL THEN 'Both'
//           WHEN ra.check_in_time IS NOT NULL THEN 'Regular Only'
//           WHEN ca.first_check_in IS NOT NULL THEN 'Client Only'
//           ELSE 'No Attendance'
//         END as attendance_pattern
//       FROM dates d
//       LEFT JOIN regular_attendance ra ON d.date = ra.date
//       LEFT JOIN client_attendance ca ON d.date = ca.date
//       ORDER BY d.date DESC
//     `, [
//       startDate || new Date().toISOString().split('T')[0],
//       endDate || new Date().toISOString().split('T')[0],
//       employeeId,
//       startDate || new Date().toISOString().split('T')[0],
//       endDate || new Date().toISOString().split('T')[0],
//       employeeId,
//       startDate || new Date().toISOString().split('T')[0],
//       endDate || new Date().toISOString().split('T')[0]
//     ]);

//     res.json({
//       success: true,
//       data: {
//         employee: employee,
//         daily_comparison: dailyComparison.rows,
//         period: {
//           start_date: startDate || new Date().toISOString().split('T')[0],
//           end_date: endDate || new Date().toISOString().split('T')[0]
//         }
//       }
//     });
//   } catch (error) {
//     console.error('Error fetching sales employee detail:', error);
//     res.status(500).json({
//       success: false,
//       error: 'Failed to fetch sales employee detail'
//     });
//   }
// };

const getSalesEmployeeDetail = async (req, res) => {
  try {
    const employeeCode = req.params.id;
    const { startDate, endDate } = req.query;
    const companyId = req.user.company_id;

    if (!employeeCode) {
      return res.status(400).json({
        success: false,
        error: 'Invalid or missing employee code'
      });
    }

    // =========================
    // 1️⃣ Verify Sales Employee
    // =========================
    const employee = await knex('employees')
      .leftJoin('departments', 'employees.department_id', 'departments.id')
      .select(
        'employees.id',
        'employees.first_name',
        'employees.last_name',
        'employees.employee_id',
        'departments.name as department_name'
      )
      .where('employees.employee_id', employeeCode)
      .where('employees.company_id', companyId)
      .where('departments.name', 'like', '%sales%')
      .first();

    if (!employee) {
      return res.status(404).json({
        success: false,
        error: 'Sales employee not found'
      });
    }

    const employeeId = employee.id;

    // =========================
    // 2️⃣ Regular Attendance (FIXED)
    // =========================
    const regularAttendance = await knex('attendance')
      .select(
        knex.raw('DATE(check_in) as date'),
        'check_in',
        'check_out'
      )
      .where('employee_id', employeeId)
      .whereNotNull('check_in')
      .whereRaw('DATE(check_in) BETWEEN ? AND ?', [
        startDate || '1970-01-01',
        endDate || new Date().toISOString().split('T')[0]
      ]);

    // =========================
    // 3️⃣ Client Attendance
    // =========================
    const clientAttendance = await knex('client_attendance')
      .select(
        'date',
        'check_in_time',
        'check_out_time',
        'duration_minutes',
        'work_completed',
        'check_out_location',
        'check_out_notes',
        'geo_fence_verified',
        'geo_fence_verified_checkout',
        'distance_from_client',
        'distance_from_client_checkout'
      )
      .where('employee_id', employeeId)
      .whereBetween('date', [
        startDate || '1970-01-01',
        endDate || new Date().toISOString().split('T')[0]
      ]);

    // =========================
    // 4️⃣ Process Data - Keep individual client visits for detailed view
    // =========================
    const map = new Map();

    // First, add regular attendance
    regularAttendance.forEach(r => {
      map.set(r.date, {
        date: r.date,
        regular_check_in: r.check_in,
        regular_check_out: r.check_out,
        client_first_check_in: null,
        client_last_check_out: null,
        client_visits: 0,
        total_minutes: 0,
        client_attendance_details: [] // Array to store individual client visits
      });
    });

    // Then, add client attendance with full details
    clientAttendance.forEach(c => {
      if (!map.has(c.date)) {
        map.set(c.date, {
          date: c.date,
          regular_check_in: null,
          regular_check_out: null,
          client_first_check_in: null,
          client_last_check_out: null,
          client_visits: 0,
          total_minutes: 0,
          client_attendance_details: []
        });
      }

      const row = map.get(c.date);

      row.client_visits += 1;
      row.total_minutes += c.duration_minutes || 0;

      if (!row.client_first_check_in || c.check_in_time < row.client_first_check_in) {
        row.client_first_check_in = c.check_in_time;
      }

      if (!row.client_last_check_out || c.check_out_time > row.client_last_check_out) {
        row.client_last_check_out = c.check_out_time;
      }

      // Add individual client visit details
      row.client_attendance_details.push({
        check_in_time: c.check_in_time,
        check_out_time: c.check_out_time,
        duration_minutes: c.duration_minutes,
        work_completed: c.work_completed,
        check_out_location: c.check_out_location,
        check_out_notes: c.check_out_notes,
        geo_fence_verified: c.geo_fence_verified,
        geo_fence_verified_checkout: c.geo_fence_verified_checkout,
        distance_from_client: c.distance_from_client,
        distance_from_client_checkout: c.distance_from_client_checkout
      });
    });

    // =========================
    // 5️⃣ Attendance Pattern
    // =========================
    const daily_comparison = Array.from(map.values())
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .map(row => ({
        ...row,
        attendance_pattern:
          row.regular_check_in && row.client_first_check_in
            ? 'Both'
            : row.regular_check_in
            ? 'Regular Only'
            : row.client_first_check_in
            ? 'Client Only'
            : 'No Attendance'
      }));

    // =========================
    // ✅ FINAL RESPONSE
    // =========================
    res.json({
      success: true,
      data: {
        employee,
        daily_comparison,
        period: {
          start_date: startDate || null,
          end_date: endDate || null
        }
      }
    });

  } catch (error) {
    console.error('Error fetching sales employee detail:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch sales employee detail'
    });
  }
};


module.exports = {
  getSalesAttendanceComparison,
  getSalesEmployeeDetail
};
