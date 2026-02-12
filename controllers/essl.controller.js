const knex = require('../db/db');
const { doCheckIn, doCheckOut } = require('../services/attendance.service');

const esslPunch = async (req, res) => {
  try {
    const { employee_code, verify_type, timestamp } = req.body;

    const employee = await knex('employees')
      .where({ employee_code })
      .first();

    if (!employee) return res.json({ success: false });

    const active = await knex('attendance')
      .where({
        employee_id: employee.id,
        company_id: employee.company_id
      })
      .whereNull('check_out')
      .whereRaw('DATE(check_in) = DATE(?)', [timestamp])
      .first();

    if (!active) {
      await doCheckIn({
        employeeId: employee.id,
        companyId: employee.company_id,
        deviceInfo: `ESSL-${verify_type}`
      });
    } else {
      await doCheckOut({
        employeeId: employee.id,
        companyId: employee.company_id,
        deviceInfo: `ESSL-${verify_type}`
      });
    }

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'ESSL processing error' });
  }
};

module.exports = { esslPunch };
