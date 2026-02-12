const knex = require('../db/db');

// Get today's client attendance for employee
// const getTodayClientAttendance = async (req, res) => {
//   try {
//     const employeeId = req.user.id;
//     const today = new Date().toISOString().split('T')[0];
    
//     const attendance = await knex('client_attendance')
//       .leftJoin('clients', 'client_attendance.client_id', 'clients.id')
//       .select(
//         'client_attendance.*',
//         'clients.client_name',
//         'clients.client_id as client_code'
//       )
//       .where('client_attendance.employee_id', employeeId)
//       .where('client_attendance.date', today)
//       .orderBy('client_attendance.check_in_time', 'asc');

//     res.json({
//       success: true,
//       data: attendance
//     });
//   } catch (error) {
//     console.error('Error fetching client attendance:', error);
//     res.status(500).json({
//       success: false,
//       error: 'Failed to fetch client attendance'
//     });
//   }
// };

const getTodayClientAttendance = async (req, res) => {
  try {
    const userId = req.user.id;
    const companyId = req.user.company_id;
    const role = req.user.role;

    const today = new Date().toISOString().split('T')[0];

    // ===============================
    // BASE QUERY
    // ===============================
    const query = knex('client_attendance')
      .leftJoin('employees', 'client_attendance.employee_id', 'employees.id')
      .leftJoin('clients', 'client_attendance.client_id', 'clients.id')
      .leftJoin('departments', 'employees.department_id', 'departments.id')
      .select(
        'client_attendance.*',
        'clients.client_name',
        'clients.client_id as client_code',
        'employees.first_name',
        'employees.last_name',
        'employees.employee_id as emp_code'
      )
      .where('employees.company_id', companyId)
      .whereRaw('LOWER(departments.name) LIKE ?', ['%sales%'])
      .where('client_attendance.date', today)
      .orderBy('client_attendance.check_in_time', 'asc');

    // ===============================
    // ROLE CONDITION
    // ===============================
    if (role !== 'admin') {
      // Employee → only own attendance
      query.andWhere('client_attendance.employee_id', userId);
    }
    // Admin → sees all sales employees (no extra filter)

    const attendance = await query;

    res.json({
      success: true,
      data: attendance
    });

  } catch (error) {
    console.error('Error fetching client attendance:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch client attendance'
    });
  }
};


// Check-in to client location with geo-tag
const checkInToClient = async (req, res) => {
  try {
    const employeeId = req.user.id;
    const { clientId, latitude, longitude, location, notes } = req.body;
    const today = new Date().toISOString().split('T')[0];
    const now = new Date();

    // Verify client is assigned to this employee
    const client = await knex('clients')
      .where({ id: clientId, assigned_to: employeeId })
      .first();

    if (!client) {
      return res.status(403).json({
        success: false,
        error: 'Client not assigned to you'
      });
    }

    // Check geo-fence if configured
    if (client.geo_latitude && client.geo_longitude) {
      const distance = calculateDistance(
        latitude, 
        longitude,
        client.geo_latitude, 
        client.geo_longitude
      );

      const radius = client.geo_radius || 50;
      
      if (distance > radius) {
        return res.status(403).json({
          success: false,
          error: `You are too far from client location. Distance: ${Math.round(distance)}m (Allowed: ${radius}m)`,
          distance: Math.round(distance),
          radius: radius
        });
      }
    }

    // Check if already checked in to this client today
    const existingCheckIn = await knex('client_attendance')
      .where({
        employee_id: employeeId,
        client_id: clientId,
        date: today,
        check_out_time: null
      })
      .first();

    if (existingCheckIn) {
      return res.status(400).json({
        success: false,
        error: 'Already checked in to this client'
      });
    }

    // Create check-in record
    const [newAttendanceId] = await knex('client_attendance').insert({
      employee_id: employeeId,
      client_id: clientId,
      date: today,
      check_in_time: now,
      check_in_latitude: latitude,
      check_in_longitude: longitude,
      check_in_location: location,
      check_in_notes: notes,
      geo_fence_verified: client.geo_latitude ? true : false,
      distance_from_client: client.geo_latitude ? calculateDistance(latitude, longitude, client.geo_latitude, client.geo_longitude) : null
    });

    const newAttendance = await knex('client_attendance')
      .leftJoin('clients', 'client_attendance.client_id', 'clients.id')
      .select(
        'client_attendance.*',
        'clients.client_name',
        'clients.client_id as client_code'
      )
      .where('client_attendance.id', newAttendanceId)
      .first();

    res.status(201).json({
      success: true,
      message: client.geo_latitude ? 'Checked in successfully within geo-fence' : 'Checked in successfully',
      data: newAttendance
    });
  } catch (error) {
    console.error('Error checking in:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to check in'
    });
  }
};

// Calculate distance between two coordinates in meters
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3; // Earth's radius in meters
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const deltaLambda = (lon2 - lon1) * Math.PI / 180;

  const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
          Math.cos(φ1) * Math.cos(φ2) *
          Math.sin(deltaLambda/2) * Math.sin(deltaLambda/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

  return R * c; // Distance in meters
}

// Check-out from client with notes and geo-tag
const checkOutFromClient = async (req, res) => {
  try {
    const employeeId = req.user.id;
    const { attendanceId, latitude, longitude, location, notes, workCompleted } = req.body;
    const now = new Date();

    // Get the attendance record with client details
    const attendance = await knex('client_attendance')
      .leftJoin('clients', 'client_attendance.client_id', 'clients.id')
      .select(
        'client_attendance.*',
        'clients.geo_latitude',
        'clients.geo_longitude',
        'clients.geo_radius'
      )
      .where({
        'client_attendance.id': attendanceId,
        'client_attendance.employee_id': employeeId,
        'client_attendance.check_out_time': null
      })
      .first();

    if (!attendance) {
      return res.status(404).json({
        success: false,
        error: 'Active check-in not found'
      });
    }

    // Check geo-fence if configured
    if (attendance.geo_latitude && attendance.geo_longitude) {
      const distance = calculateDistance(
        latitude, 
        longitude,
        attendance.geo_latitude, 
        attendance.geo_longitude
      );

      const radius = attendance.geo_radius || 50;
      
      if (distance > radius) {
        return res.status(403).json({
          success: false,
          error: `You are too far from client location. Distance: ${Math.round(distance)}m (Allowed: ${radius}m)`,
          distance: Math.round(distance),
          radius: radius
        });
      }
    }

    // Calculate duration
    const checkInTime = new Date(attendance.check_in_time);
    const duration = Math.round((now - checkInTime) / (1000 * 60)); // duration in minutes

    // Update with check-out details
    await knex('client_attendance')
      .where({ id: attendanceId })
      .update({
        check_out_time: now,
        check_out_latitude: latitude,
        check_out_longitude: longitude,
        check_out_location: location,
        check_out_notes: notes,
        work_completed: workCompleted,
        duration_minutes: duration,
        geo_fence_verified_checkout: attendance.geo_latitude ? true : false,
        distance_from_client_checkout: attendance.geo_latitude ? calculateDistance(latitude, longitude, attendance.geo_latitude, attendance.geo_longitude) : null
      });

    // Get updated record with client info
    const updatedAttendance = await knex('client_attendance')
      .leftJoin('clients', 'client_attendance.client_id', 'clients.id')
      .select(
        'client_attendance.*',
        'clients.client_name',
        'clients.client_id as client_code'
      )
      .where('client_attendance.id', attendanceId)
      .first();

    res.json({
      success: true,
      message: attendance.geo_latitude ? 'Checked out successfully within geo-fence' : 'Checked out successfully',
      data: updatedAttendance
    });
  } catch (error) {
    console.error('Error checking out:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to check out'
    });
  }
};

// Get client attendance history
const getClientAttendanceHistory = async (req, res) => {
  try {
    const employeeId = req.user.id;
    const { startDate, endDate, clientId } = req.query;

    let query = knex('client_attendance')
      .leftJoin('clients', 'client_attendance.client_id', 'clients.id')
      .select(
        'client_attendance.*',
        'clients.client_name',
        'clients.client_id as client_code'
      )
      .where('client_attendance.employee_id', employeeId);

    if (startDate) {
      query = query.where('client_attendance.date', '>=', startDate);
    }
    if (endDate) {
      query = query.where('client_attendance.date', '<=', endDate);
    }
    if (clientId) {
      query = query.where('client_attendance.client_id', clientId);
    }

    const attendance = await query.orderBy('client_attendance.date', 'desc');

    res.json({
      success: true,
      data: attendance
    });
  } catch (error) {
    console.error('Error fetching attendance history:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch attendance history'
    });
  }
};

// Get current active check-in
const getActiveCheckIn = async (req, res) => {
  try {
    const employeeId = req.user.id;
    const today = new Date().toISOString().split('T')[0];

    const activeCheckIn = await knex('client_attendance')
      .leftJoin('clients', 'client_attendance.client_id', 'clients.id')
      .select(
        'client_attendance.*',
        'clients.client_name',
        'clients.client_id as client_code'
      )
      .where('client_attendance.employee_id', employeeId)
      .where('client_attendance.date', today)
      .where('client_attendance.check_out_time', null)
      .first();

    res.json({
      success: true,
      data: activeCheckIn || null
    });
  } catch (error) {
    console.error('Error fetching active check-in:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch active check-in'
    });
  }
};

// Get all client attendance data for admin
const getAllClientAttendance = async (req, res) => {
  try {
    const { startDate, endDate, employeeId, clientId } = req.query;
    const companyId = req.user.company_id;

    let query = knex('client_attendance')
      .leftJoin('clients', 'client_attendance.client_id', 'clients.id')
      .leftJoin('employees', 'client_attendance.employee_id', 'employees.id')
      .leftJoin('departments', 'employees.department_id', 'departments.id')
      .select(
        'client_attendance.*',
        'clients.client_name',
        'clients.client_id as client_code',
        'employees.first_name',
        'employees.last_name',
        'employees.employee_id as employee_code',
        'departments.name as department_name'
      )
      .where('employees.company_id', companyId);

    if (startDate) {
      query = query.where('client_attendance.date', '>=', startDate);
    }
    if (endDate) {
      query = query.where('client_attendance.date', '<=', endDate);
    }
    if (employeeId) {
      query = query.where('client_attendance.employee_id', employeeId);
    }
    if (clientId) {
      query = query.where('client_attendance.client_id', clientId);
    }

    const attendance = await query.orderBy('client_attendance.date', 'desc');

    res.json({
      success: true,
      data: attendance
    });
  } catch (error) {
    console.error('Error fetching all client attendance:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch client attendance data'
    });
  }
};

module.exports = {
  getTodayClientAttendance,
  checkInToClient,
  checkOutFromClient,
  getClientAttendanceHistory,
  getActiveCheckIn,
  getAllClientAttendance
};
