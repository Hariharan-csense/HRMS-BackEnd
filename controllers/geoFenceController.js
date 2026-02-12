const knex = require('../db/db');

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

// Update client with geo-fence coordinates
const updateClientGeoFence = async (req, res) => {
  try {
    const { clientId } = req.params;
    const { latitude, longitude, radius = 50 } = req.body;
    const companyId = req.user.company_id;

    // Verify client belongs to company
    const client = await knex('clients')
      .where({ id: clientId, company_id: companyId })
      .first();

    if (!client) {
      return res.status(404).json({
        success: false,
        error: 'Client not found'
      });
    }

    // Update client with geo-fence coordinates
    await knex('clients')
      .where({ id: clientId })
      .update({
        geo_latitude: latitude,
        geo_longitude: longitude,
        geo_radius: radius,
        updated_at: new Date()
      });

    const updatedClient = await knex('clients')
      .where({ id: clientId })
      .first();

    res.json({
      success: true,
      message: 'Client geo-fence updated successfully',
      data: updatedClient
    });
  } catch (error) {
    console.error('Error updating client geo-fence:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update client geo-fence'
    });
  }
};

// Check if employee is within client geo-fence
const checkGeoFence = async (req, res) => {
  try {
    const { clientId, employeeLatitude, employeeLongitude } = req.body;
    const companyId = req.user.company_id;

    // Get client geo-fence details
    const client = await knex('clients')
      .where({ 
        id: clientId, 
        company_id: companyId
      })
      .whereNotNull('geo_latitude')
      .whereNotNull('geo_longitude')
      .first();

    if (!client) {
      return res.json({
        success: true,
        withinFence: true, // Allow if no geo-fence is set
        message: 'No geo-fence configured for this client'
      });
    }

    // Calculate distance
    const distance = calculateDistance(
      employeeLatitude, 
      employeeLongitude,
      client.geo_latitude, 
      client.geo_longitude
    );

    const withinFence = distance <= (client.geo_radius || 50);

    res.json({
      success: true,
      withinFence,
      distance: Math.round(distance),
      radius: client.geo_radius || 50,
      clientLocation: {
        latitude: client.geo_latitude,
        longitude: client.geo_longitude
      },
      message: withinFence 
        ? 'Within client geo-fence' 
        : `Outside client geo-fence. You are ${Math.round(distance)}m away, need to be within ${client.geo_radius || 50}m`
    });
  } catch (error) {
    console.error('Error checking geo-fence:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to check geo-fence'
    });
  }
};

// Get all clients with geo-fence status
const getClientsWithGeoFence = async (req, res) => {
  try {
    const companyId = req.user.company_id;

    const clients = await knex('clients')
      .select(
        'clients.*',
        knex.raw(`
          CASE 
            WHEN clients.geo_latitude IS NOT NULL AND clients.geo_longitude IS NOT NULL 
            THEN 'Enabled' 
            ELSE 'Disabled' 
          END as geo_fence_status
        `)
      )
      .where('company_id', companyId)
      .orderBy('clients.client_name');

    res.json({
      success: true,
      data: clients
    });
  } catch (error) {
    console.error('Error fetching clients with geo-fence:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch clients'
    });
  }
};

// Enhanced check-in with geo-fence validation
const checkInWithGeoFence = async (req, res) => {
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
    console.error('Error checking in with geo-fence:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to check in'
    });
  }
};

// Enhanced check-out with geo-fence validation
const checkOutWithGeoFence = async (req, res) => {
  try {
    const employeeId = req.user.id;
    const { attendanceId, latitude, longitude, location, notes, workCompleted } = req.body;
    const now = new Date();

    // Get the attendance record
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
    console.error('Error checking out with geo-fence:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to check out'
    });
  }
};

module.exports = {
  updateClientGeoFence,
  checkGeoFence,
  getClientsWithGeoFence,
  checkInWithGeoFence,
  checkOutWithGeoFence
};
